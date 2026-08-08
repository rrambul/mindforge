import type { ActualMinutes, IsoDate, PlanSubject } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import { SequentialIdGenerator } from "../../../shared/ids/id-generator.js";
import { FixedClock } from "../../../shared/time/clock.js";
import {
  AllocationNeedsOneSubject,
  DuplicatePlanSubject,
  MissionParked,
  PlanSubjectMissing,
} from "../domain/errors.js";
import { subjectKey } from "../domain/plan-subject.js";
import { WeeklyPlan } from "../domain/weekly-plan.js";
import type { WeeklyPlanRepository } from "../domain/weekly-plan.repository.js";
import type { WeeklyReview } from "../domain/weekly-review.js";
import type { WeeklyReviewRepository } from "../domain/weekly-review.repository.js";
import type { ActualMinutesReader, MinutesWindow } from "./actual-minutes.port.js";
import type { PlanSubjectDetail, PlanSubjectReader } from "./plan-subjects.port.js";
import {
  CompleteWeeklyReview,
  GetPlanVsActual,
  GetWeeklyPlan,
  ListWeeklyReviews,
  PutWeeklyPlan,
} from "./planning.use-cases.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const RUST = "33333333-3333-4333-8333-333333333333";
const PARKED = "55555555-5555-4555-8555-555555555555";
const OWNERSHIP = "44444444-4444-4444-8444-444444444444";
const MISSING = "99999999-9999-4999-8999-999999999999";

/** 2026-08-03 is a Monday; the 5th is the Wednesday inside the same week. */
const MONDAY: IsoDate = "2026-08-03";
const WEDNESDAY: IsoDate = "2026-08-05";
/** The Sunday that starts the same week for a `weekStartsOn: 0` profile. */
const SUNDAY: IsoDate = "2026-08-02";

const NOW = new Date("2026-08-05T09:00:00Z");
const LATER = new Date("2026-08-07T18:30:00Z");

/**
 * Loads and stores through snapshots, exactly as the Prisma repository does.
 *
 * Handing back the stored instance instead would make every in-memory mutation a write, and the
 * tests that prove a rejected plan leaves the old one alone would pass for the wrong reason.
 */
class InMemoryPlans implements WeeklyPlanRepository {
  private readonly byUser = new Map<string, Map<IsoDate, WeeklyPlan>>();
  writes = 0;

  private own(userId: string): Map<IsoDate, WeeklyPlan> {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const created = new Map<IsoDate, WeeklyPlan>();
    this.byUser.set(userId, created);
    return created;
  }

  findByWeek(userId: string, weekStart: IsoDate): Promise<WeeklyPlan | null> {
    const stored = this.own(userId).get(weekStart);
    return Promise.resolve(stored ? WeeklyPlan.fromSnapshot(stored.toSnapshot()) : null);
  }

  replace(userId: string, plan: WeeklyPlan): Promise<void> {
    this.writes += 1;
    this.own(userId).set(plan.weekStart, WeeklyPlan.fromSnapshot(plan.toSnapshot()));
    return Promise.resolve();
  }

  /** How many weeks this user has planned — the check that normalisation did not fork a week. */
  weekCount(userId: string): number {
    return this.own(userId).size;
  }
}

class StubPlanSubjects implements PlanSubjectReader {
  private readonly known = new Map<string, PlanSubjectDetail>();

  add(userId: string, subject: PlanSubject, label: string, parked = false): this {
    this.known.set(`${userId}|${subjectKey(subject)}`, { label, parked });
    return this;
  }

  read(
    userId: string,
    subjects: readonly PlanSubject[],
  ): Promise<Readonly<Record<string, PlanSubjectDetail>>> {
    const details: Record<string, PlanSubjectDetail> = {};
    for (const subject of subjects) {
      // Absent means "not this user's" — which is what RLS makes of both a missing row and someone
      // else's row.
      const detail = this.known.get(`${userId}|${subjectKey(subject)}`);
      if (detail) details[subjectKey(subject)] = detail;
    }
    return Promise.resolve(details);
  }
}

class StubActuals implements ActualMinutesReader {
  private readonly byUser = new Map<string, ActualMinutes[]>();
  /** The last window asked for, which is how the timezone maths is asserted without a database. */
  window: MinutesWindow | null = null;

  set(userId: string, minutes: ActualMinutes[]): this {
    this.byUser.set(userId, minutes);
    return this;
  }

  read(userId: string, window: MinutesWindow): Promise<ActualMinutes[]> {
    this.window = window;
    return Promise.resolve(this.byUser.get(userId) ?? []);
  }
}

/** Mirrors the adapter's contract: an existing week is revised, and `completedAt` does not move. */
class InMemoryReviews implements WeeklyReviewRepository {
  private readonly byUser = new Map<string, Map<IsoDate, WeeklyReview>>();

  private own(userId: string): Map<IsoDate, WeeklyReview> {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const created = new Map<IsoDate, WeeklyReview>();
    this.byUser.set(userId, created);
    return created;
  }

  save(userId: string, review: WeeklyReview): Promise<WeeklyReview> {
    const existing = this.own(userId).get(review.weekStart);
    const stored: WeeklyReview = existing
      ? { ...existing, changedOneThing: review.changedOneThing, note: review.note }
      : review;
    this.own(userId).set(review.weekStart, stored);
    return Promise.resolve(stored);
  }

  list(userId: string, limit: number): Promise<WeeklyReview[]> {
    const all = [...this.own(userId).values()].sort((a, b) =>
      b.weekStart.localeCompare(a.weekStart),
    );
    return Promise.resolve(all.slice(0, limit));
  }
}

describe("GetWeeklyPlan", () => {
  let plans: InMemoryPlans;
  let read: GetWeeklyPlan;

  beforeEach(() => {
    plans = new InMemoryPlans();
    read = new GetWeeklyPlan(plans);
  });

  it("reports a week nobody planned as an empty week, not as missing", async () => {
    // "You have not planned this week" is where every week starts. A 404 would put an error state on
    // the screen whose whole job is to let you plan.
    await expect(read.execute(ALICE, MONDAY, 1)).resolves.toEqual({
      weekStart: MONDAY,
      plan: null,
    });
  });

  it("answers a mid-week date with that date's week", async () => {
    // A client asking for a Wednesday must not get a phantom week starting on Wednesday.
    const result = await read.execute(ALICE, WEDNESDAY, 1);
    expect(result.weekStart).toBe(MONDAY);
  });

  it("follows the profile's week start rather than the locale at render time (FR-L5)", async () => {
    const result = await read.execute(ALICE, WEDNESDAY, 0);
    expect(result.weekStart).toBe(SUNDAY);
  });

  it("never reads another user's plan", async () => {
    const plan = WeeklyPlan.forWeek({ id: "p", userId: BOB, weekStart: MONDAY });
    plan.replaceAllocations([{ subject: { kind: "mission", id: RUST }, plannedMinutes: 300 }]);
    await plans.replace(BOB, plan);

    await expect(read.execute(ALICE, MONDAY, 1)).resolves.toMatchObject({ plan: null });
  });
});

describe("PutWeeklyPlan (FR-F5)", () => {
  let plans: InMemoryPlans;
  let subjects: StubPlanSubjects;
  let put: PutWeeklyPlan;

  beforeEach(() => {
    plans = new InMemoryPlans();
    subjects = new StubPlanSubjects()
      .add(ALICE, { kind: "mission", id: RUST }, "Learn Rust")
      .add(ALICE, { kind: "mission", id: PARKED }, "Kubernetes", true)
      .add(ALICE, { kind: "skill", id: OWNERSHIP }, "Ownership")
      .add(BOB, { kind: "mission", id: MISSING }, "Bob's mission");
    put = new PutWeeklyPlan(plans, subjects, new SequentialIdGenerator());
  });

  it("creates the plan for a week that had none", async () => {
    const result = await put.execute(ALICE, MONDAY, 1, {
      allocations: [{ missionId: RUST, plannedMinutes: 300 }],
    });

    expect(result.plan?.plannedTotal).toBe(300);
    await expect(plans.findByWeek(ALICE, MONDAY)).resolves.not.toBeNull();
  });

  it("plans against a skill, which is what focus_sessions.skill_id exists for", async () => {
    const result = await put.execute(ALICE, MONDAY, 1, {
      allocations: [{ skillId: OWNERSHIP, plannedMinutes: 120 }],
    });

    expect(result.plan?.allocations).toEqual([
      { subject: { kind: "skill", id: OWNERSHIP }, plannedMinutes: 120 },
    ]);
  });

  it("replaces the whole week rather than merging", async () => {
    await put.execute(ALICE, MONDAY, 1, {
      allocations: [
        { missionId: RUST, plannedMinutes: 300 },
        { skillId: OWNERSHIP, plannedMinutes: 120 },
      ],
    });
    const result = await put.execute(ALICE, MONDAY, 1, {
      allocations: [{ skillId: OWNERSHIP, plannedMinutes: 60 }],
    });

    expect(result.plan?.allocations).toHaveLength(1);
    expect(result.plan?.plannedTotal).toBe(60);
  });

  it("clears a week", async () => {
    await put.execute(ALICE, MONDAY, 1, {
      allocations: [{ missionId: RUST, plannedMinutes: 300 }],
    });
    const cleared = await put.execute(ALICE, MONDAY, 1, { allocations: [] });

    expect(cleared.plan?.allocations).toEqual([]);
  });

  it("writes one week whether the client sends the Monday or the Wednesday", async () => {
    // The failure this prevents: a second `weekly_plans` row for a week that already had one, which
    // the grid could then never find again.
    await put.execute(ALICE, MONDAY, 1, {
      allocations: [{ missionId: RUST, plannedMinutes: 300 }],
    });
    const midweek = await put.execute(ALICE, WEDNESDAY, 1, {
      allocations: [{ missionId: RUST, plannedMinutes: 60 }],
    });

    expect(midweek.weekStart).toBe(MONDAY);
    expect(plans.weekCount(ALICE)).toBe(1);
  });

  it("refuses a mission that no longer exists", async () => {
    // Reachable just by having the grid open in one tab and deleting a mission in another.
    await expect(
      put.execute(ALICE, MONDAY, 1, { allocations: [{ missionId: MISSING, plannedMinutes: 60 }] }),
    ).rejects.toBeInstanceOf(PlanSubjectMissing);
  });

  it("refuses another user's mission as missing, which is all the caller may know", async () => {
    await expect(
      put.execute(ALICE, MONDAY, 1, { allocations: [{ missionId: MISSING, plannedMinutes: 60 }] }),
    ).rejects.toBeInstanceOf(PlanSubjectMissing);
    // Bob can plan against the very same mission.
    await expect(
      put.execute(BOB, MONDAY, 1, { allocations: [{ missionId: MISSING, plannedMinutes: 60 }] }),
    ).resolves.toMatchObject({ weekStart: MONDAY });
  });

  it("refuses a parked mission (§5.3)", async () => {
    // Parking says you are not working on it; allocating hours to it is a contradiction rather than
    // a typo, which is why this is a conflict and not a validation failure.
    const failure = put.execute(ALICE, MONDAY, 1, {
      allocations: [{ missionId: PARKED, plannedMinutes: 60 }],
    });

    await expect(failure).rejects.toBeInstanceOf(MissionParked);
    await expect(failure).rejects.toMatchObject({ kind: "conflict" });
  });

  it("refuses the same subject twice before the unique index turns it into a 500", async () => {
    await expect(
      put.execute(ALICE, MONDAY, 1, {
        allocations: [
          { missionId: RUST, plannedMinutes: 300 },
          { missionId: RUST, plannedMinutes: 60 },
        ],
      }),
    ).rejects.toBeInstanceOf(DuplicatePlanSubject);
  });

  it("refuses an allocation naming both a mission and a skill", async () => {
    await expect(
      put.execute(ALICE, MONDAY, 1, {
        allocations: [{ missionId: RUST, skillId: OWNERSHIP, plannedMinutes: 60 }],
      }),
    ).rejects.toBeInstanceOf(AllocationNeedsOneSubject);
  });

  it("refuses an allocation naming neither", async () => {
    await expect(
      put.execute(ALICE, MONDAY, 1, { allocations: [{ plannedMinutes: 60 }] }),
    ).rejects.toBeInstanceOf(AllocationNeedsOneSubject);
  });

  it("writes nothing when one allocation is bad", async () => {
    // Validated before the only write, so a bad id cannot leave half a week planned — the trap
    // `CreateSkill` fell into by validating after its save.
    await put.execute(ALICE, MONDAY, 1, {
      allocations: [{ missionId: RUST, plannedMinutes: 300 }],
    });
    const writesBefore = plans.writes;

    await expect(
      put.execute(ALICE, MONDAY, 1, {
        allocations: [
          { missionId: RUST, plannedMinutes: 60 },
          { missionId: MISSING, plannedMinutes: 60 },
        ],
      }),
    ).rejects.toBeInstanceOf(PlanSubjectMissing);

    expect(plans.writes).toBe(writesBefore);
    const stored = await plans.findByWeek(ALICE, MONDAY);
    expect(stored?.plannedTotal).toBe(300);
  });
});

describe("GetPlanVsActual (FR-F5)", () => {
  let plans: InMemoryPlans;
  let actuals: StubActuals;
  let subjects: StubPlanSubjects;
  let read: GetPlanVsActual;

  beforeEach(() => {
    plans = new InMemoryPlans();
    actuals = new StubActuals();
    subjects = new StubPlanSubjects()
      .add(ALICE, { kind: "mission", id: RUST }, "Learn Rust")
      .add(ALICE, { kind: "mission", id: PARKED }, "Kubernetes", true)
      .add(ALICE, { kind: "skill", id: OWNERSHIP }, "Ownership");
    read = new GetPlanVsActual(plans, actuals, subjects);
  });

  async function planWeek(allocations: { subject: PlanSubject; plannedMinutes: number }[]) {
    const plan = WeeklyPlan.forWeek({ id: "plan-1", userId: ALICE, weekStart: MONDAY });
    plan.replaceAllocations(allocations);
    await plans.replace(ALICE, plan);
  }

  it("puts what you did beside what you said, with the subject's name", async () => {
    await planWeek([{ subject: { kind: "mission", id: RUST }, plannedMinutes: 300 }]);
    actuals.set(ALICE, [{ subject: { kind: "mission", id: RUST }, minutes: 240 }]);

    const result = await read.execute(ALICE, MONDAY, 1, "UTC");

    expect(result.rows).toEqual([
      {
        subject: { kind: "mission", id: RUST },
        label: "Learn Rust",
        plannedMinutes: 300,
        actualMinutes: 240,
        deltaMinutes: -60,
        attainment: 0.8,
      },
    ]);
    expect(result.plannedTotal).toBe(300);
    expect(result.actualTotal).toBe(240);
  });

  it("reports a planned subject you did nothing on as zero, because that is a measurement", async () => {
    await planWeek([{ subject: { kind: "skill", id: OWNERSHIP }, plannedMinutes: 120 }]);

    const result = await read.execute(ALICE, MONDAY, 1, "UTC");

    expect(result.rows[0]).toMatchObject({ actualMinutes: 0, attainment: 0 });
  });

  it("gives unplanned work no attainment at all", async () => {
    // Two hours against a plan of nothing is not 200% and not "over target" — it is work you did
    // without planning it, which the review shows you rather than scores.
    actuals.set(ALICE, [{ subject: { kind: "skill", id: OWNERSHIP }, minutes: 120 }]);

    const result = await read.execute(ALICE, MONDAY, 1, "UTC");

    expect(result.rows[0]).toMatchObject({
      label: "Ownership",
      plannedMinutes: null,
      actualMinutes: 120,
      attainment: null,
    });
    expect(result.unplannedMinutes).toBe(120);
    // No plan at all, so there is no week-level attainment either.
    expect(result.attainment).toBeNull();
  });

  it("excludes a mission parked after the week was planned, from both sides (§5.3)", async () => {
    await planWeek([
      { subject: { kind: "mission", id: RUST }, plannedMinutes: 300 },
      { subject: { kind: "mission", id: PARKED }, plannedMinutes: 600 },
    ]);
    actuals.set(ALICE, [
      { subject: { kind: "mission", id: RUST }, minutes: 240 },
      { subject: { kind: "mission", id: PARKED }, minutes: 90 },
    ]);

    const result = await read.execute(ALICE, MONDAY, 1, "UTC");

    expect(result.rows.map((row) => row.subject.id)).toEqual([RUST]);
    // Both sides, so the totals still describe the same set of rows.
    expect(result.plannedTotal).toBe(300);
    expect(result.actualTotal).toBe(240);
  });

  it("labels a vanished subject null rather than inventing a name", async () => {
    actuals.set(ALICE, [{ subject: { kind: "mission", id: MISSING }, minutes: 30 }]);

    const result = await read.execute(ALICE, MONDAY, 1, "UTC");

    expect(result.rows[0]?.label).toBeNull();
  });

  it("asks for the seven days as the caller's own timezone measures them", async () => {
    // São Paulo is UTC−3, so the week begins at 03:00Z on the Monday and ends at 03:00Z on the next.
    // Subtracting a fixed offset happens to work here and is wrong twice a year elsewhere, which is
    // why the bounds come from `dayBounds` rather than from arithmetic.
    await read.execute(ALICE, WEDNESDAY, 1, "America/Sao_Paulo");

    expect(actuals.window?.from.toISOString()).toBe("2026-08-03T03:00:00.000Z");
    expect(actuals.window?.to.toISOString()).toBe("2026-08-10T03:00:00.000Z");
  });

  it("falls back to UTC for a timezone the platform does not know", async () => {
    // `profiles.timezone` is free text. One bad row must not turn the review screen into a 500.
    await read.execute(ALICE, MONDAY, 1, "Mars/Olympus_Mons");

    expect(actuals.window?.from.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });

  it("answers an untouched week with nothing rather than with zeroes", async () => {
    const result = await read.execute(ALICE, MONDAY, 1, "UTC");

    expect(result.rows).toEqual([]);
    expect(result.attainment).toBeNull();
  });

  it("normalises the week like every other route here", async () => {
    const result = await read.execute(ALICE, WEDNESDAY, 0, "UTC");
    expect(result.weekStart).toBe(SUNDAY);
  });
});

describe("CompleteWeeklyReview (FR-F6)", () => {
  let reviews: InMemoryReviews;
  let complete: CompleteWeeklyReview;

  beforeEach(() => {
    reviews = new InMemoryReviews();
    complete = new CompleteWeeklyReview(reviews, new FixedClock(NOW), new SequentialIdGenerator());
  });

  it("records the ritual against the normalised week", async () => {
    const review = await complete.execute(ALICE, WEDNESDAY, 1, {
      changedOneThing: "Two focus blocks before lunch instead of four after it",
    });

    expect(review.weekStart).toBe(MONDAY);
    expect(review.completedAt).toEqual(NOW);
    expect(review.changedOneThing).toBe("Two focus blocks before lunch instead of four after it");
  });

  it("accepts a review that changed nothing", async () => {
    // A week where nothing needs changing is a real answer, and forcing a sentence produces a
    // fabricated one (§7.2).
    const review = await complete.execute(ALICE, MONDAY, 1, {});

    expect(review.changedOneThing).toBeNull();
    expect(review.note).toBeNull();
  });

  it("revises rather than conflicting on a second submission", async () => {
    await complete.execute(ALICE, MONDAY, 1, { changedOneThing: "first thought" });
    const revised = await complete.execute(ALICE, MONDAY, 1, { changedOneThing: "on reflection" });

    expect(revised.changedOneThing).toBe("on reflection");
    await expect(reviews.list(ALICE, 52)).resolves.toHaveLength(1);
  });

  it("keeps the moment the ritual happened when it is revised", async () => {
    // A correction on Wednesday must not restamp Sunday's review as Wednesday's: M2's finish line
    // counts reviews, and a cadence read off a column that moves is not a cadence.
    await complete.execute(ALICE, MONDAY, 1, { changedOneThing: "first thought" });

    const later = new CompleteWeeklyReview(
      reviews,
      new FixedClock(LATER),
      new SequentialIdGenerator(),
    );
    const revised = await later.execute(ALICE, MONDAY, 1, { changedOneThing: "on reflection" });

    expect(revised.completedAt).toEqual(NOW);
  });
});

describe("ListWeeklyReviews", () => {
  let reviews: InMemoryReviews;
  let complete: CompleteWeeklyReview;
  let list: ListWeeklyReviews;

  beforeEach(() => {
    reviews = new InMemoryReviews();
    complete = new CompleteWeeklyReview(reviews, new FixedClock(NOW), new SequentialIdGenerator());
    list = new ListWeeklyReviews(reviews);
  });

  it("returns the newest week first", async () => {
    await complete.execute(ALICE, "2026-07-20", 1, {});
    await complete.execute(ALICE, "2026-08-03", 1, {});
    await complete.execute(ALICE, "2026-07-27", 1, {});

    await expect(list.execute(ALICE)).resolves.toMatchObject([
      { weekStart: "2026-08-03" },
      { weekStart: "2026-07-27" },
      { weekStart: "2026-07-20" },
    ]);
  });

  it("caps at a year of weeks", async () => {
    for (let i = 0; i < 60; i += 1) {
      // Distinct Mondays, walking backwards a week at a time.
      const week = new Date(Date.UTC(2026, 7, 3) - i * 7 * 86_400_000).toISOString().slice(0, 10);
      await complete.execute(ALICE, week, 1, {});
    }

    await expect(list.execute(ALICE)).resolves.toHaveLength(52);
  });

  it("never lists another user's reviews", async () => {
    await complete.execute(BOB, MONDAY, 1, {});
    await expect(list.execute(ALICE)).resolves.toEqual([]);
  });
});
