import {
  addDays,
  dayBounds,
  planVsActual,
  resolveTimeZone,
  startOfWeek,
  type CompleteWeeklyReviewInput,
  type IsoDate,
  type PlanRow,
  type PlanSubject,
  type PlanVsActual,
  type PutWeeklyPlanInput,
  type WeekStart,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { ID_GENERATOR, type IdGenerator } from "../../../shared/ids/id-generator.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { MissionParked, PlanSubjectMissing } from "../domain/errors.js";
import { planSubjectFrom, subjectKey } from "../domain/plan-subject.js";
import { WeeklyPlan, type PlannedAllocation } from "../domain/weekly-plan.js";
import {
  WEEKLY_PLAN_REPOSITORY,
  type WeeklyPlanRepository,
} from "../domain/weekly-plan.repository.js";
import type { WeeklyReview } from "../domain/weekly-review.js";
import {
  WEEKLY_REVIEW_REPOSITORY,
  type WeeklyReviewRepository,
} from "../domain/weekly-review.repository.js";
import { ACTUAL_MINUTES, type ActualMinutesReader } from "./actual-minutes.port.js";
import { PLAN_SUBJECTS, type PlanSubjectReader } from "./plan-subjects.port.js";

/**
 * The weekly rhythm (FR-F5, FR-F6) — §6's `planning` module.
 *
 * One decision runs through every use case here: **the week a request is about is decided by the
 * server, from the caller's profile.** A client sends a date; `startOfWeek` turns it into the first
 * day of the week that date falls in, honouring `profiles.week_starts_on` (Monday for en, Sunday for
 * pt-BR — FR-L5). Without that, a client asking for a Wednesday would create a "week" starting on
 * Wednesday: a row the grid can never find again, a second plan for a week that already had one, and
 * a plan-vs-actual whose seven days overlap two real weeks. The normalised value goes back in every
 * response, so the SPA can tell it asked for something else.
 */

/** A week, and what is planned for it. `plan` is null when the week was never planned. */
export interface WeeklyPlanResult {
  /** Normalised. This, not what the client asked for, is the week that was read or written. */
  readonly weekStart: IsoDate;
  readonly plan: WeeklyPlan | null;
}

@Injectable()
export class GetWeeklyPlan {
  constructor(@Inject(WEEKLY_PLAN_REPOSITORY) private readonly plans: WeeklyPlanRepository) {}

  async execute(
    userId: string,
    requested: IsoDate,
    weekStartsOn: WeekStart,
  ): Promise<WeeklyPlanResult> {
    const weekStart = startOfWeek(requested, weekStartsOn);
    // Null, not a 404. "You have not planned this week" is where every week starts, and a missing
    // resource is a different claim — one that would have the SPA render an error state on the
    // screen whose whole job is to let you plan.
    return { weekStart, plan: await this.plans.findByWeek(userId, weekStart) };
  }
}

/**
 * Replaces a week's allocations (FR-F5).
 *
 * Everything is checked before `replace` is called, which is the only write. A bad allocation
 * therefore cannot leave half a week planned — the trap `CreateSkill` fell into by validating after
 * its save, and the reason `SetResourceLinks` is written the same way.
 */
@Injectable()
export class PutWeeklyPlan {
  constructor(
    @Inject(WEEKLY_PLAN_REPOSITORY) private readonly plans: WeeklyPlanRepository,
    @Inject(PLAN_SUBJECTS) private readonly subjects: PlanSubjectReader,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(
    userId: string,
    requested: IsoDate,
    weekStartsOn: WeekStart,
    input: PutWeeklyPlanInput,
  ): Promise<WeeklyPlanResult> {
    const weekStart = startOfWeek(requested, weekStartsOn);

    // `planSubjectFrom` is the check constraint: an allocation naming both a mission and a skill, or
    // neither, cannot become a value at all.
    const allocations: PlannedAllocation[] = input.allocations.map((allocation) => ({
      subject: planSubjectFrom(allocation.missionId, allocation.skillId),
      plannedMinutes: allocation.plannedMinutes,
    }));

    // Created rather than refused when the week has no plan: a first plan is a PUT like any other,
    // and making the client POST once and PUT thereafter would be an ordering rule with no upside.
    const plan =
      (await this.plans.findByWeek(userId, weekStart)) ??
      WeeklyPlan.forWeek({ id: this.ids.next(), userId, weekStart });

    // Refuses a duplicated subject before either the unique indexes or the reader below sees it —
    // this is a fault in the request that needs no round trip to diagnose.
    plan.replaceAllocations(allocations);

    await this.assertPlannable(
      userId,
      allocations.map((allocation) => allocation.subject),
    );

    await this.plans.replace(userId, plan);
    return { weekStart, plan };
  }

  private async assertPlannable(userId: string, subjects: readonly PlanSubject[]): Promise<void> {
    const details = await this.subjects.read(userId, subjects);

    for (const subject of subjects) {
      const detail = details[subjectKey(subject)];
      if (!detail) throw new PlanSubjectMissing(subject.kind, subject.id);
      // §5.3: a parked mission is excluded from allocation. Only a mission can be parked, so the flag
      // is false for every skill and this branch is about missions alone.
      if (detail.parked) throw new MissionParked(subject.id);
    }
  }
}

/** A plan-vs-actual row with the name of the thing it is about. */
export interface LabelledPlanRow extends PlanRow {
  /**
   * Null when the subject has no readable name — a row whose mission vanished between the sessions
   * being logged and the week being reviewed. Null rather than "Unknown" or an empty string, so the
   * SPA decides how to say so and no fabricated label reaches a screen.
   */
  readonly label: string | null;
}

export interface WeeklyPlanVsActual extends Omit<PlanVsActual, "rows"> {
  /** Normalised, as everywhere else in this module. */
  readonly weekStart: IsoDate;
  readonly rows: readonly LabelledPlanRow[];
}

/**
 * The core weekly insight (FR-F5): what you said you would do, against what you did.
 *
 * The arithmetic is `planVsActual` in `packages/core` — non-negotiable 3, so the review screen and
 * any later rollup cannot disagree about an attainment. What this use case owns is the three things
 * that package cannot know:
 *
 * - **Which seven days those are.** The window is `[start of the first local day, start of the day
 *   after the last)`, derived from the caller's timezone. A week is a calendar fact (§5.2), and
 *   subtracting a fixed offset is wrong twice a year in most of the world.
 * - **What the rows are called**, which is a join this module reaches through a port.
 * - **That parked missions are excluded from both sides** (§5.3).
 */
@Injectable()
export class GetPlanVsActual {
  constructor(
    @Inject(WEEKLY_PLAN_REPOSITORY) private readonly plans: WeeklyPlanRepository,
    @Inject(ACTUAL_MINUTES) private readonly actuals: ActualMinutesReader,
    @Inject(PLAN_SUBJECTS) private readonly subjects: PlanSubjectReader,
  ) {}

  async execute(
    userId: string,
    requested: IsoDate,
    weekStartsOn: WeekStart,
    timeZone: string,
  ): Promise<WeeklyPlanVsActual> {
    const weekStart = startOfWeek(requested, weekStartsOn);
    // Coerced rather than trusted: `profiles.timezone` is free text, and a hand-edited row must not
    // turn the review screen into a 500. `resolveTimeZone` falls back to UTC, which is wrong for that
    // user until they fix their setting and right for everyone else.
    const zone = resolveTimeZone(timeZone);
    const from = dayBounds(weekStart, zone).start;
    const to = dayBounds(addDays(weekStart, 6), zone).end;

    const plan = await this.plans.findByWeek(userId, weekStart);
    const worked = await this.actuals.read(userId, { from, to });

    const planned = plan?.allocations ?? [];
    const details = await this.subjects.read(userId, [
      ...planned.map((allocation) => allocation.subject),
      ...worked.map((entry) => entry.subject),
    ]);

    // §5.3, both sides. A mission parked *after* the week was planned still has its allocation row
    // and still has its sessions; showing either would be scoring you against a decision you already
    // made — and dropping only one side would make the totals disagree with the rows.
    const isParked = (subject: PlanSubject): boolean =>
      details[subjectKey(subject)]?.parked === true;

    const result = planVsActual(
      planned.filter((allocation) => !isParked(allocation.subject)),
      worked.filter((entry) => !isParked(entry.subject)),
    );

    return {
      ...result,
      weekStart,
      rows: result.rows.map((row) => ({
        ...row,
        label: details[subjectKey(row.subject)]?.label ?? null,
      })),
    };
  }
}

/**
 * Records the ritual (FR-F6).
 *
 * The id and the timestamp are minted here and used only if the row is new — see the repository. A
 * second submission for the same week updates what you decided without moving when you decided it.
 */
@Injectable()
export class CompleteWeeklyReview {
  constructor(
    @Inject(WEEKLY_REVIEW_REPOSITORY) private readonly reviews: WeeklyReviewRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  execute(
    userId: string,
    requested: IsoDate,
    weekStartsOn: WeekStart,
    input: CompleteWeeklyReviewInput,
  ): Promise<WeeklyReview> {
    return this.reviews.save(userId, {
      id: this.ids.next(),
      userId,
      weekStart: startOfWeek(requested, weekStartsOn),
      completedAt: this.clock.now(),
      // Absent and explicitly null are the same thing here: both mean "nothing to record", and the
      // column is nullable precisely so that stays a legitimate answer rather than a forced sentence.
      changedOneThing: input.changedOneThing ?? null,
      note: input.note ?? null,
    });
  }
}

/**
 * A year of weeks.
 *
 * Capped like every other list in this codebase, and generously: the review history is what makes
 * M2's finish line — "three weekly reviews and changed one thing because of one" — visible, and
 * nobody scrolls past a year of it. There is no cursor pagination anywhere in this product yet, so
 * this does not invent one.
 */
const DEFAULT_LIMIT = 52;

@Injectable()
export class ListWeeklyReviews {
  constructor(@Inject(WEEKLY_REVIEW_REPOSITORY) private readonly reviews: WeeklyReviewRepository) {}

  execute(userId: string): Promise<WeeklyReview[]> {
    return this.reviews.list(userId, DEFAULT_LIMIT);
  }
}
