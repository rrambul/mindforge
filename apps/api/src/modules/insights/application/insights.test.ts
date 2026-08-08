import { addDays, type ActivityDay, type IsoDate } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../shared/time/clock.js";
import type { ActivityGridReader, ActivityRows, DayRange } from "./activity-grid.port.js";
import type { BacklogReader, BacklogRow } from "./backlog.port.js";
import type { FrictionAnalyticsReader, FrictionCell } from "./friction-analytics.port.js";
import {
  GetActivityGrid,
  GetBacklogHealth,
  GetFrictionAnalytics,
  type CalendarSettings,
} from "./insights.use-cases.js";
import { MIN_ACTIVE_DAYS_FOR_MEDIAN, plannedDaysPerWeek } from "./planned-days.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const RUST = "33333333-3333-4333-8333-333333333333";
const OCAML = "44444444-4444-4444-8444-444444444444";

/** A Wednesday, so `startOfWeek` has something to do. */
const NOW = new Date("2026-08-05T09:00:00Z");
const TODAY: IsoDate = "2026-08-05";

const UTC: CalendarSettings = { timezone: "UTC", weekStartsOn: 1 };

class InMemoryActivity implements ActivityGridReader {
  days: ActivityDay[] = [];
  rebuiltAt: Date | null = null;
  /** Null means "no plan in the span", which is the case the signal has to stay silent for. */
  plannedMinutes: number | null = null;
  planLookups: DayRange[] = [];

  daysIn(_userId: string, range: DayRange): Promise<ActivityRows> {
    return Promise.resolve({
      days: this.days.filter((day) => day.day >= range.from && day.day <= range.to),
      rebuiltAt: this.rebuiltAt,
    });
  }

  plannedMinutesInForce(_userId: string, weeks: DayRange): Promise<number | null> {
    this.planLookups.push(weeks);
    return Promise.resolve(this.plannedMinutes);
  }
}

class InMemoryBacklog implements BacklogReader {
  rows: BacklogRow[] = [];

  // The scoping this parameter drives is Postgres' job and is covered by the integration suite;
  // these tests are about the maths. Discarded rather than underscore-prefixed, which the repo's
  // lint config does not exempt.
  listWithLastTouch(userId: string): Promise<BacklogRow[]> {
    void userId;
    return Promise.resolve(this.rows);
  }
}

class InMemoryFrictionAnalytics implements FrictionAnalyticsReader {
  cells: FrictionCell[] = [];

  crossTab(): Promise<FrictionCell[]> {
    return Promise.resolve(this.cells);
  }
}

function activeDay(
  day: IsoDate,
  focusMinutes: number,
  friction = { ember: 0, slag: 0 },
): ActivityDay {
  return {
    day,
    focusMinutes,
    emberMinutes: friction.ember,
    slagMinutes: friction.slag,
    notesCaptured: 0,
  };
}

function resource(row: Partial<BacklogRow> & { id: string }): BacklogRow {
  return {
    status: "inbox",
    addedAt: new Date("2026-08-01T10:00:00Z"),
    finishedAt: null,
    abandonReason: null,
    lastTouchedAt: null,
    ...row,
  };
}

function cell(row: Partial<FrictionCell> & { type: FrictionCell["type"] }): FrictionCell {
  return {
    missionId: null,
    missionTopic: null,
    count: 1,
    intensitySum: 3,
    standaloneCount: 0,
    ...row,
  };
}

describe("plannedDaysPerWeek (§3.9)", () => {
  const fourDays = [60, 60, 60, 60];

  it("divides the plan by a typical day you show up", () => {
    // 300 planned, a typical active day is 75 → the plan assumes four days.
    expect(plannedDaysPerWeek(300, [30, 75, 75, 300])).toBe(4);
  });

  it("ignores the empty days, because rest days are not short days", () => {
    // Counting the zeroes would drag the median to nothing and claim the plan assumes far more
    // days than it does.
    expect(plannedDaysPerWeek(240, [0, 0, 60, 60, 60, 60, 0])).toBe(4);
  });

  it("takes the median, so one long Saturday does not raise the bar", () => {
    expect(plannedDaysPerWeek(240, [60, 60, 60, 600])).toBe(4);
  });

  it("averages the middle two when the count is even", () => {
    // 50 and 70 → 60, not 50 and not 70.
    expect(plannedDaysPerWeek(180, [40, 50, 70, 80])).toBe(3);
  });

  it("says nothing when there is no plan", () => {
    expect(plannedDaysPerWeek(null, fourDays)).toBeNull();
  });

  it("says nothing when the plan allocates no minutes", () => {
    // A plan row whose allocations were all deleted is not a plan of zero days.
    expect(plannedDaysPerWeek(0, fourDays)).toBeNull();
  });

  it("says nothing until there are enough active days to have a typical one", () => {
    expect(plannedDaysPerWeek(300, fourDays.slice(0, MIN_ACTIVE_DAYS_FOR_MEDIAN - 1))).toBeNull();
    expect(plannedDaysPerWeek(300, fourDays)).not.toBeNull();
  });

  it("says nothing when the plan is smaller than one typical day", () => {
    // Fewer than one day a week is not something the pace signal can phrase, so it is absent
    // rather than rounded to zero and rendered.
    expect(plannedDaysPerWeek(20, [120, 120, 120, 120])).toBeNull();
  });

  it("caps at seven, because a week has seven days", () => {
    expect(plannedDaysPerWeek(6000, [30, 30, 30, 30])).toBe(7);
  });
});

describe("GetActivityGrid (FR-I6b)", () => {
  let activity: InMemoryActivity;
  let grid: GetActivityGrid;

  beforeEach(() => {
    activity = new InMemoryActivity();
    grid = new GetActivityGrid(activity);
  });

  const range = { from: addDays(TODAY, -27), to: TODAY };

  it("draws a cell for every day in the range, including the empty ones", async () => {
    activity.days = [activeDay(TODAY, 45)];

    const result = await grid.execute(ALICE, { ...range, layer: "focus" }, UTC);

    expect(result.grid.cells).toHaveLength(28);
    expect(result.grid.cells.at(-1)).toMatchObject({ day: TODAY, value: 45 });
    expect(result.grid.cells[0]).toMatchObject({ value: 0, intensity: 0 });
  });

  it("switches the cell value to notes without changing what counts as active", async () => {
    activity.days = [{ ...activeDay(TODAY, 45), notesCaptured: 3 }];

    const result = await grid.execute(ALICE, { ...range, layer: "notes" }, UTC);

    expect(result.grid.cells.at(-1)?.value).toBe(3);
    // Showing up is a fact about the day, not about the layer being drawn.
    expect(result.grid.activeDaysIn28).toBe(1);
  });

  it("reports when the rollup last wrote the range", async () => {
    const rebuilt = new Date("2026-08-05T03:00:00Z");
    activity.rebuiltAt = rebuilt;

    expect((await grid.execute(ALICE, { ...range, layer: "focus" }, UTC)).rebuiltAt).toBe(rebuilt);
  });

  it("draws the pace line when a plan and enough history exist", async () => {
    activity.plannedMinutes = 300;
    activity.days = [-1, -2, -3, -4].map((offset) => activeDay(addDays(TODAY, offset), 75));

    const result = await grid.execute(ALICE, { ...range, layer: "focus" }, UTC);

    // 300 ÷ 75 = 4 planned days; four active days in four weeks is an average of 1.
    expect(result.grid.signal).toEqual({
      kind: "pace_below_plan",
      averageActiveDays: 1,
      plannedDays: 4,
    });
  });

  it("asks only for a plan whose week overlaps the four weeks it is compared against", async () => {
    activity.plannedMinutes = 300;

    await grid.execute(ALICE, { ...range, layer: "focus" }, UTC);

    // Monday weeks, so both bounds are Mondays: 2026-07-06 (the week 2026-07-09 falls in) through
    // 2026-08-03 (the week of TODAY).
    expect(activity.planLookups).toEqual([{ from: "2026-07-06", to: "2026-08-03" }]);
  });

  it("honours a Sunday week start when choosing which plans are in force", async () => {
    activity.plannedMinutes = 300;

    await grid.execute(ALICE, { ...range, layer: "focus" }, { timezone: "UTC", weekStartsOn: 0 });

    expect(activity.planLookups).toEqual([{ from: "2026-07-05", to: "2026-08-02" }]);
  });

  it("never reads a plan for a range shorter than the four weeks the line describes", async () => {
    activity.plannedMinutes = 300;
    activity.days = [-1, -2, -3, -4].map((offset) => activeDay(addDays(TODAY, offset), 75));

    // "Your last four weeks average 0.9 active days" from seven days of data is a sentence that is
    // both wrong and damning, so the line is withheld rather than scaled.
    const result = await grid.execute(
      ALICE,
      { from: addDays(TODAY, -6), to: TODAY, layer: "focus" },
      UTC,
    );

    expect(result.grid.signal).toBeNull();
    expect(activity.planLookups).toEqual([]);
  });

  it("draws no pace line when there is no plan to compare against", async () => {
    activity.plannedMinutes = null;
    activity.days = [-1, -2, -3, -4].map((offset) => activeDay(addDays(TODAY, offset), 75));

    expect((await grid.execute(ALICE, { ...range, layer: "focus" }, UTC)).grid.signal).toBeNull();
  });
});

describe("GetBacklogHealth (FR-I7, FR-R6)", () => {
  let backlog: InMemoryBacklog;
  let health: GetBacklogHealth;

  beforeEach(() => {
    backlog = new InMemoryBacklog();
    health = new GetBacklogHealth(backlog, new FixedClock(NOW));
  });

  const query = { windowDays: 28 };

  it("buckets every instant into the caller's own timezone", async () => {
    // 23:30 UTC on the 4th is already the 5th in Tokyo. Bucketing in UTC would age the item by a
    // day for every user east of Greenwich, which is exactly what §5.2 forbids.
    backlog.rows = [
      resource({
        id: "a",
        status: "active",
        addedAt: new Date("2026-08-04T23:30:00Z"),
        lastTouchedAt: new Date("2026-08-04T23:30:00Z"),
      }),
    ];

    const tokyo = await health.execute(ALICE, query, { timezone: "Asia/Tokyo", weekStartsOn: 1 });
    // 2026-08-05 in Tokyo, and the Tokyo "today" is the 5th too — nothing has aged.
    expect(tokyo.oldestOpenDays).toBe(0);

    const utc = await health.execute(ALICE, query, UTC);
    expect(utc.oldestOpenDays).toBe(1);
  });

  it("reports the last touch a session gave a resource, and never-touched as null", async () => {
    backlog.rows = [
      resource({
        id: "stalled",
        status: "active",
        addedAt: new Date("2026-01-01T10:00:00Z"),
        lastTouchedAt: new Date("2026-06-01T10:00:00Z"),
      }),
      resource({ id: "untouched", status: "active", addedAt: new Date("2026-01-01T10:00:00Z") }),
    ];

    const result = await health.execute(ALICE, query, UTC);

    expect(result.stalled).toEqual([
      { id: "untouched", untouchedDays: 216, lastTouchedOn: null },
      { id: "stalled", untouchedDays: 65, lastTouchedOn: "2026-06-01" },
    ]);
  });

  it("counts a finish inside the window and leaves the open items open", async () => {
    backlog.rows = [
      resource({
        id: "done",
        status: "finished",
        addedAt: new Date("2026-07-20T10:00:00Z"),
        finishedAt: new Date("2026-08-01T10:00:00Z"),
      }),
      resource({ id: "open", status: "queued", addedAt: new Date("2026-07-25T10:00:00Z") }),
    ];

    const result = await health.execute(ALICE, query, UTC);

    expect(result).toMatchObject({ added: 2, finished: 1, resolved: 1, openCount: 1 });
    // Nothing was abandoned, so 0% is a measurement rather than a gap.
    expect(result.abandonmentRate).toBe(0);
    expect(result.abandonment).toEqual({ total: 0, reasons: [] });
  });

  it("reports abandonment as a gap rather than as a zero", async () => {
    // `resources` has no abandoned_at, so none of these can be placed in the window. Publishing
    // "0 abandoned, 0% rate" to someone who quit three books is the exact failure mode
    // non-negotiable 10 names.
    backlog.rows = [
      resource({ id: "a", status: "abandoned", abandonReason: "too shallow" }),
      resource({ id: "b", status: "abandoned", abandonReason: "too shallow" }),
      resource({ id: "c", status: "abandoned", abandonReason: "wrong level" }),
      resource({ id: "d", status: "abandoned", abandonReason: "wrong level" }),
      resource({ id: "e", status: "abandoned", abandonReason: "dull" }),
      resource({ id: "f", status: "abandoned", abandonReason: null }),
      resource({
        id: "g",
        status: "finished",
        finishedAt: new Date("2026-08-02T10:00:00Z"),
      }),
    ];

    const result = await health.execute(ALICE, query, UTC);

    expect(result.abandonment).toEqual({
      total: 6,
      // Descending by count, then by reason — two equally common reasons must not swap places
      // between requests. The reason is optional (FR-R5), so the sixth counts and explains nothing.
      reasons: [
        { reason: "too shallow", count: 2 },
        { reason: "wrong level", count: 2 },
        { reason: "dull", count: 1 },
      ],
    });
    expect(result.abandonmentRate).toBeNull();
  });

  it("withdraws a growing signal the abandonment gap could have produced", async () => {
    // Five added, one finished, two abandoned. Core sees netChange 4 and says the queue is growing;
    // had the two abandonments landed in the window it would be 2 and say nothing.
    const addedAt = new Date("2026-08-01T10:00:00Z");
    backlog.rows = [
      resource({ id: "a", status: "inbox", addedAt }),
      resource({ id: "b", status: "inbox", addedAt }),
      resource({ id: "c", status: "inbox", addedAt }),
      resource({ id: "d", status: "abandoned", addedAt, abandonReason: "wrong level" }),
      resource({
        id: "e",
        status: "finished",
        addedAt,
        finishedAt: new Date("2026-08-03T10:00:00Z"),
      }),
    ];

    expect((await health.execute(ALICE, query, UTC)).signal).toEqual({
      kind: "growing",
      added: 5,
      resolved: 1,
    });

    backlog.rows = [
      ...backlog.rows,
      resource({ id: "f", status: "abandoned", addedAt, abandonReason: "wrong level" }),
    ];

    // Six added now, and two undated abandonments: growth of 3 either way survives, so the signal
    // is kept only because it is true under the most favourable reading.
    expect((await health.execute(ALICE, query, UTC)).signal).toMatchObject({ kind: "growing" });

    backlog.rows = backlog.rows.filter((row) => row.status !== "inbox");
    expect((await health.execute(ALICE, query, UTC)).signal).toBeNull();
  });

  it("leaves a stalling signal alone, because it reads no resolution date", async () => {
    backlog.rows = ["a", "b", "c"].map((id) =>
      resource({ id, status: "active", addedAt: new Date("2026-01-01T10:00:00Z") }),
    );
    backlog.rows.push(resource({ id: "quit", status: "abandoned", abandonReason: "dull" }));

    expect((await health.execute(ALICE, query, UTC)).signal).toMatchObject({ kind: "stalling" });
  });

  it("honours a narrower window", async () => {
    backlog.rows = [resource({ id: "a", addedAt: new Date("2026-07-25T10:00:00Z") })];

    expect((await health.execute(ALICE, { windowDays: 7 }, UTC)).added).toBe(0);
    expect((await health.execute(ALICE, { windowDays: 28 }, UTC)).added).toBe(1);
  });

  it("falls back to UTC rather than failing on a timezone nobody can parse", async () => {
    backlog.rows = [resource({ id: "a", addedAt: new Date("2026-08-04T23:30:00Z") })];

    const result = await health.execute(ALICE, query, {
      timezone: "Mars/Olympus",
      weekStartsOn: 1,
    });

    expect(result.oldestOpenDays).toBe(1);
  });
});

describe("GetFrictionAnalytics (FR-I6b)", () => {
  let reader: InMemoryFrictionAnalytics;
  let analytics: GetFrictionAnalytics;

  beforeEach(() => {
    reader = new InMemoryFrictionAnalytics();
    analytics = new GetFrictionAnalytics(reader);
  });

  it("folds the cross-tab into counts by type and by mission", async () => {
    reader.cells = [
      cell({ type: "tooling", missionId: RUST, missionTopic: "Rust", count: 4, intensitySum: 16 }),
      cell({ type: "tooling", missionId: OCAML, missionTopic: "OCaml", count: 1, intensitySum: 2 }),
      cell({ type: "too_hard", missionId: RUST, missionTopic: "Rust", count: 2, intensitySum: 9 }),
    ];

    const result = await analytics.execute(ALICE, {});

    expect(result.eventCount).toBe(7);
    expect(result.byType).toEqual([
      { type: "tooling", count: 5, meanIntensity: 3.6 },
      { type: "too_hard", count: 2, meanIntensity: 4.5 },
    ]);
    expect(result.byMission).toEqual([
      { missionId: RUST, topic: "Rust", count: 6 },
      { missionId: OCAML, topic: "OCaml", count: 1 },
    ]);
  });

  it("breaks a tie on the taxonomy's order, never alphabetically", async () => {
    // `avoidance` sorts above `tooling` by letter and below it in FRICTION_TYPES. Alphabetical
    // order is the trap that has bitten this codebase twice, and here it would crown a rare type
    // as your biggest friction source.
    reader.cells = [
      cell({ type: "avoidance", count: 3, intensitySum: 9 }),
      cell({ type: "interruption", count: 3, intensitySum: 9 }),
      cell({ type: "tooling", count: 3, intensitySum: 9 }),
    ];

    expect((await analytics.execute(ALICE, {})).byType.map((row) => row.type)).toEqual([
      "interruption",
      "tooling",
      "avoidance",
    ]);
  });

  it("reports friction with no mission as unattributed, split by why", async () => {
    reader.cells = [
      cell({ type: "tooling", missionId: RUST, missionTopic: "Rust", count: 2, intensitySum: 6 }),
      // One tap outside any session, two inside sessions that were never given a mission.
      cell({ type: "interruption", count: 3, intensitySum: 9, standaloneCount: 1 }),
    ];

    const result = await analytics.execute(ALICE, {});

    expect(result.unattributed).toEqual({ total: 3, standalone: 1, sessionWithoutMission: 2 });
    // Counted in the total and in byType, so "interruption is your top source" still includes them.
    expect(result.eventCount).toBe(5);
    expect(result.byType[0]).toMatchObject({ type: "interruption", count: 3 });
    expect(result.byMission).toHaveLength(1);
  });

  it("answers an empty history with zeroes rather than nothing", async () => {
    expect(await analytics.execute(ALICE, {})).toEqual({
      eventCount: 0,
      byType: [],
      byMission: [],
      unattributed: { total: 0, standalone: 0, sessionWithoutMission: 0 },
    });
  });

  it("orders two equally frictional missions deterministically", async () => {
    reader.cells = [
      cell({ type: "tooling", missionId: OCAML, missionTopic: "Zig", count: 2, intensitySum: 6 }),
      cell({ type: "tooling", missionId: RUST, missionTopic: "Rust", count: 2, intensitySum: 6 }),
    ];

    expect((await analytics.execute(ALICE, {})).byMission.map((row) => row.topic)).toEqual([
      "Rust",
      "Zig",
    ]);
  });
});
