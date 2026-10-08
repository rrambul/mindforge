import { FixedClock } from "@mindforge/core";
import { describe, expect, it } from "vitest";

import type {
  CurriculumReader,
  CurriculumRows,
  ExamRow,
  LessonRow,
  PaceRows,
  TrackRow,
} from "./curriculum.port.js";
import { GetCurriculum } from "./get-curriculum.js";

/**
 * The curriculum's read side (FR-K5, FR-E6, FR-U1, FR-U4, FR-B1–B5).
 *
 * The maths is `packages/core`'s and tested there. What is tested here is the join:
 * that exams are kept out of the lessons, that the schedule is chained over the
 * modules the screen shows, that "today" is the learner's, and that a deadline is
 * refused on exactly the states the screen shows.
 */

const USER = "user-1";
const MISSION = "mission-1";
// 02:30 UTC on the 2nd is still the 1st in São Paulo.
const NOW = new Date("2026-10-02T02:30:00Z");
const TZ = "America/Sao_Paulo";
const AT = new Date("2026-09-20T12:00:00Z");

function track(id: string, over: Partial<TrackRow> = {}): TrackRow {
  return {
    id,
    slug: id,
    name: id.toUpperCase(),
    outcome: null,
    position: 1,
    status: "proposed",
    week: null,
    prerequisites: [],
    ...over,
  };
}

function lesson(id: string, trackId: string, over: Partial<LessonRow> = {}): LessonRow {
  return {
    id,
    trackId,
    slug: id,
    title: `Lesson ${id}`,
    intent: null,
    status: "generated",
    difficulty: 2,
    depth: "working",
    position: 1,
    seq: 1,
    completedAt: null,
    outcome: null,
    prerequisiteIds: [],
    strain: { verdict: null, unknown: "in-progress" },
    adjustment: null,
    ...over,
  };
}

function exam(trackId: string, over: Partial<ExamRow> = {}): ExamRow {
  return {
    id: `exam-${trackId}`,
    trackId,
    title: `Exam: ${trackId}`,
    seq: 9,
    items: [{ key: "a", covers: ["l1"], grading: "checked", attempts: [] }],
    ...over,
  };
}

const NO_PACE: PaceRows = { lessonMinutes: [], recentMinutes: 0 };

class FakeReader implements CurriculumReader {
  since: Date | null = null;
  constructor(public rows: CurriculumRows | null) {}

  read(_userId: string, _missionId: string, since: Date): Promise<CurriculumRows | null> {
    this.since = since;
    return Promise.resolve(this.rows);
  }
}

function rows(over: Partial<CurriculumRows> = {}): CurriculumRows {
  return {
    tracks: [track("t1"), track("t2", { position: 2 })],
    lessons: [lesson("l1", "t1"), lesson("l2", "t2")],
    exams: [],
    calendar: null,
    pace: NO_PACE,
    // Long before NOW, so the pace window is the whole 28 days unless a test says so.
    missionCreatedAt: new Date("2026-01-01T12:00:00Z"),
    ...over,
  };
}

function curriculum(reader: FakeReader) {
  return new GetCurriculum(reader, new FixedClock(NOW));
}

describe("GetCurriculum — exams", () => {
  it("is a 404 for a mission that is not yours", async () => {
    await expect(curriculum(new FakeReader(null)).execute(USER, MISSION, TZ)).rejects.toThrow(
      "mission_not_found",
    );
  });

  it("reads today, and the pace window, in the learner's timezone", async () => {
    const reader = new FakeReader(rows());
    const view = await curriculum(reader).execute(USER, MISSION, TZ);

    expect(view.today).toBe("2026-10-01");
    // 27 days before the 1st, at local midnight (-03:00).
    expect(reader.since).toEqual(new Date("2026-09-04T03:00:00Z"));
  });

  it("shows the newest exam filed under a module, and none where none is written", async () => {
    const view = await curriculum(
      new FakeReader(
        rows({
          exams: [
            exam("t1", { id: "old", seq: 4 }),
            exam("t1", { id: "new", seq: 9 }),
            exam("elsewhere"),
          ],
        }),
      ),
    ).execute(USER, MISSION, TZ);

    expect(view.modules[0]!.exam).toMatchObject({ lessonId: "new" });
    expect(view.modules[1]!.exam).toBeNull();
  });

  it("names the lessons unpassed items cover, and drops a slug the mission does not have", async () => {
    const view = await curriculum(
      new FakeReader(
        rows({
          exams: [
            exam("t1", {
              items: [{ key: "a", covers: ["l1", "ghost"], grading: "checked", attempts: [] }],
            }),
          ],
        }),
      ),
    ).execute(USER, MISSION, TZ);

    expect(view.modules[0]!.exam?.result?.revisit).toEqual([{ id: "l1", title: "Lesson l1" }]);
  });

  it("carries a null result for an exam with no items", async () => {
    const view = await curriculum(
      new FakeReader(rows({ exams: [exam("t1", { items: [] })] })),
    ).execute(USER, MISSION, TZ);

    expect(view.modules[0]!.exam?.result).toBeNull();
  });

  it("finishes a module when its lessons are done and its exam is passed", async () => {
    const view = await curriculum(
      new FakeReader(
        rows({
          lessons: [lesson("l1", "t1", { completedAt: AT }), lesson("l2", "t2")],
          exams: [
            exam("t1", {
              items: [
                {
                  key: "a",
                  covers: [],
                  grading: "self",
                  attempts: [{ createdAt: AT, passed: true }],
                },
              ],
            }),
          ],
        }),
      ),
    ).execute(USER, MISSION, TZ);

    expect(view.modules[0]!.finishedAt).toBe(AT.toISOString());
    expect(view.modules[0]!.exam?.result).toMatchObject({ passed: true, selfReportedPasses: 1 });
    expect(view.modules[0]!.projection).toEqual({ status: "finished" });
    // The finished module is not the one you are in any more.
    expect(view.currentModuleId).toBe("t2");
  });
});

describe("GetCurriculum — the pace projection", () => {
  const PACE: PaceRows = { lessonMinutes: [20, 30, 40], recentMinutes: 280 };

  it("says what is missing rather than projecting from nothing", async () => {
    const view = await curriculum(new FakeReader(rows())).execute(USER, MISSION, TZ);

    expect(view.pace).toEqual({
      status: "unknown",
      missing: ["timed-lessons", "recent-time"],
      timedLessons: 0,
    });
    expect(view.modules[0]!.projection).toEqual({ status: "unknown", reason: "no-pace" });
  });

  it("chains modules from the one you are in", async () => {
    // 30 min a lesson, 10 a day. t1: 1 lesson + exam = 6 days → Oct 6. t2: 6 more → Oct 12.
    const view = await curriculum(new FakeReader(rows({ pace: PACE }))).execute(USER, MISSION, TZ);

    expect(view.pace).toEqual({
      status: "known",
      minutesPerLesson: 30,
      timedLessons: 3,
      minutesPerDay: 10,
      windowDays: 28,
    });
    expect(view.modules[0]!.projection).toMatchObject({ examDay: "2026-10-06" });
    expect(view.modules[1]!.projection).toMatchObject({
      startDay: "2026-10-07",
      examDay: "2026-10-12",
    });
  });

  it("measures a young mission's pace over the days it has existed, not 28", async () => {
    // Created on Sep 28, local; today is Oct 1: four days, so 280 minutes is 70 a day.
    // Over 28 days it was 10, and the projection put the exam weeks too late.
    const view = await curriculum(
      new FakeReader(rows({ pace: PACE, missionCreatedAt: new Date("2026-09-28T15:00:00Z") })),
    ).execute(USER, MISSION, TZ);

    expect(view.pace).toMatchObject({ status: "known", minutesPerDay: 70, windowDays: 4 });
  });

  it("starts the chain at a module waiting on its exam, ahead of an earlier one with lessons left", async () => {
    const view = await curriculum(
      new FakeReader(
        rows({
          pace: PACE,
          lessons: [lesson("l1", "t1"), lesson("l2", "t2", { completedAt: AT })],
        }),
      ),
    ).execute(USER, MISSION, TZ);

    expect(view.currentModuleId).toBe("t2");
    expect(view.modules[1]!.projection).toMatchObject({
      startDay: "2026-10-01",
      examDay: "2026-10-03",
    });
    expect(view.modules[0]!.projection).toMatchObject({ startDay: "2026-10-04" });
  });

  it("puts a dropped module outside the chain", async () => {
    const view = await curriculum(
      new FakeReader(
        rows({
          pace: PACE,
          tracks: [track("t0", { status: "dropped", position: 0 }), track("t1")],
          lessons: [lesson("l0", "t0", { completedAt: AT }), lesson("l1", "t1")],
        }),
      ),
    ).execute(USER, MISSION, TZ);

    expect(view.modules[0]!.projection).toEqual({ status: "unknown", reason: "dropped" });
    expect(view.modules[1]!.projection).toMatchObject({ startDay: "2026-10-01" });
  });

  it("has no current module when nothing is left", async () => {
    const view = await curriculum(
      new FakeReader(rows({ tracks: [track("t1")], lessons: [] })),
    ).execute(USER, MISSION, TZ);

    expect(view.currentModuleId).toBeNull();
  });
});

describe("GetCurriculum — the week calendar (FR-B1–B5)", () => {
  // Week 1 starts Sunday Sep 27; São Paulo's "today" is Thursday Oct 1.
  const CALENDAR = { weeks: 3, startsOn: "2026-09-27" };
  const five = (trackId: string, done: number) =>
    Array.from({ length: 5 }, (_, i) =>
      lesson(`${trackId}-l${i + 1}`, trackId, {
        position: i + 1,
        difficulty: i + 1,
        completedAt: i < done ? AT : null,
      }),
    );
  const weekly = (over: Partial<CurriculumRows> = {}) =>
    rows({
      calendar: CALENDAR,
      tracks: [track("t1", { week: 1 }), track("t2", { position: 2, week: 2 })],
      lessons: [...five("t1", 2), ...five("t2", 0)],
      ...over,
    });

  it("has no calendar, no weeks and no days for a mission from before weeks", async () => {
    const view = await curriculum(new FakeReader(rows())).execute(USER, MISSION, TZ);

    expect(view.calendar).toBeNull();
    expect(view.modules[0]!.week).toBeNull();
    expect(view.modules[0]!.lessons[0]!.dueOn).toBeNull();
  });

  it("puts a module on the week it was pinned to, lessons on days 1–5, the exam on day 6", async () => {
    const view = await curriculum(new FakeReader(weekly())).execute(USER, MISSION, TZ);

    expect(view.calendar).toEqual({ ...CALENDAR, endsOn: "2026-10-17" });
    expect(view.modules[0]!.week).toMatchObject({
      index: 1,
      startsOn: "2026-09-27",
      examOn: "2026-10-02",
      endsOn: "2026-10-03",
    });
    expect(view.modules[0]!.lessons.map((l) => l.dueOn)).toEqual([
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
    ]);
    expect(view.modules[1]!.week).toMatchObject({ index: 2, startsOn: "2026-10-04" });
  });

  it("keeps a module's week when a revision moves it in the plan — dates never move", async () => {
    // The plan now lists t2 first, and a dropped t0 sits ahead of both. The weeks
    // were pinned before; nothing on the calendar moves.
    const view = await curriculum(
      new FakeReader(
        weekly({
          tracks: [
            track("t0", { status: "dropped", position: 0, week: 3 }),
            track("t2", { position: 1, week: 2 }),
            track("t1", { position: 2, week: 1 }),
          ],
          lessons: [lesson("l0", "t0", { completedAt: AT }), ...five("t1", 2), ...five("t2", 0)],
        }),
      ),
    ).execute(USER, MISSION, TZ);

    const byId = new Map(view.modules.map((module) => [module.id, module]));
    expect(byId.get("t1")!.week?.index).toBe(1);
    expect(byId.get("t2")!.week?.index).toBe(2);
    // A dropped module keeps its slot, and its finished lesson keeps its date.
    expect(byId.get("t0")!.week?.index).toBe(3);
  });

  it("gives a lesson its day from the plan's row order, not the easiest-first list", async () => {
    // Row 2 is harder than row 3; the list shows row 3 first, the calendar does not.
    const view = await curriculum(
      new FakeReader(
        weekly({
          tracks: [track("t1", { week: 1 })],
          lessons: [
            lesson("first", "t1", { position: 1, difficulty: 1 }),
            lesson("hard", "t1", { position: 2, difficulty: 4 }),
            lesson("easy", "t1", { position: 3, difficulty: 2 }),
            // A bridge: off-plan, no row, no day.
            lesson("bridge", "t1", { position: null, difficulty: null }),
          ],
        }),
      ),
    ).execute(USER, MISSION, TZ);

    const due = new Map(view.modules[0]!.lessons.map((l) => [l.id, l.dueOn]));
    expect(due.get("hard")).toBe("2026-09-28");
    expect(due.get("easy")).toBe("2026-09-29");
    expect(due.get("bridge")).toBeNull();
  });

  it("lists a week in day order and calls the next day's lesson next, not the easiest", async () => {
    // Day 3 is harder than day 4. Days 1 and 2 are done.
    const view = await curriculum(
      new FakeReader(
        weekly({
          tracks: [track("t1", { week: 1 })],
          lessons: [
            lesson("d1", "t1", { position: 1, difficulty: 1, completedAt: AT }),
            lesson("d2", "t1", { position: 2, difficulty: 2, completedAt: AT }),
            lesson("d3", "t1", { position: 3, difficulty: 3 }),
            lesson("d4", "t1", { position: 4, difficulty: 2 }),
          ],
        }),
      ),
    ).execute(USER, MISSION, TZ);

    expect(view.modules[0]!.lessons.map((l) => l.id)).toEqual(["d1", "d2", "d3", "d4"]);
    expect(view.nextLessonId).toBe("d3");
  });

  it("takes modules in the order of their weeks, even when a revision reordered the plan", async () => {
    const view = await curriculum(
      new FakeReader(
        weekly({
          tracks: [
            track("later", { position: 1, week: 2 }),
            track("first", { position: 2, week: 1 }),
          ],
          lessons: [
            lesson("l-later", "later", { position: 1 }),
            lesson("l-first", "first", { position: 1 }),
          ],
        }),
      ),
    ).execute(USER, MISSION, TZ);

    expect(view.nextLessonId).toBe("l-first");
  });

  it("still lists a mission without weeks easiest first", async () => {
    const view = await curriculum(
      new FakeReader(
        rows({
          tracks: [track("t1")],
          lessons: [
            lesson("hard", "t1", { position: 1, difficulty: 3 }),
            lesson("easy", "t1", { position: 2, difficulty: 1 }),
          ],
        }),
      ),
    ).execute(USER, MISSION, TZ);

    expect(view.modules[0]!.lessons.map((l) => l.id)).toEqual(["easy", "hard"]);
  });

  it("counts only earlier days as behind, out of the module's own total", async () => {
    const view = await curriculum(new FakeReader(weekly())).execute(USER, MISSION, TZ);

    // Thursday: Sunday to Wednesday are past, two done; Thursday's is due today.
    expect(view.modules[0]!.week!.standing).toEqual({
      kind: "in-progress",
      total: 5,
      completed: 2,
      behind: 2,
      dueToday: 1,
      examToday: false,
    });
    expect(view.modules[1]!.week!.standing).toEqual({ kind: "upcoming", startsInDays: 3 });
  });

  it("lists a bridge after the lesson it bridges, and counts it in the week like the bar does", async () => {
    // The AWS mission's week 1 on Oct 7: 0002 landed too hard, the run wrote a step
    // toward it, and it had dropped to the bottom with "2 of 5" over "2 of 6".
    const bridge = lesson("bridge", "t1", {
      position: null,
      difficulty: null,
      seq: 3,
      adjustment: { kind: "bridge", reason: "too hard", bridgeForSlug: "t1-l2" },
    });
    const view = await curriculum(
      new FakeReader(weekly({ lessons: [...five("t1", 2), bridge, ...five("t2", 0)] })),
    ).execute(USER, MISSION, TZ);

    const week1 = view.modules[0]!;
    expect(week1.lessons.map((l) => l.id)).toEqual([
      "t1-l1",
      "t1-l2",
      "bridge",
      "t1-l3",
      "t1-l4",
      "t1-l5",
    ]);
    // Taken next: it is the step before the rest of the week.
    expect(view.nextLessonId).toBe("bridge");
    expect(week1.progress).toEqual({ completed: 2, total: 6 });
    // Six in the count, and still no day of its own: never behind, never due.
    expect(week1.week!.standing).toMatchObject({ total: 6, completed: 2, behind: 2, dueToday: 1 });
  });

  it("opens a module once a lesson in it is finished, whatever the plan proposed", async () => {
    const view = await curriculum(new FakeReader(weekly())).execute(USER, MISSION, TZ);

    expect(view.modules[0]!.status).toBe("active");
    expect(view.modules[1]!.status).toBe("proposed");
  });

  it("says a week with no lessons planned is not planned", async () => {
    const view = await curriculum(new FakeReader(weekly({ lessons: [] }))).execute(
      USER,
      MISSION,
      TZ,
    );

    expect(view.modules[0]!.week!.standing).toEqual({ kind: "not-planned" });
  });

  it("gives no dates to a week past the mission's last, or a module never pinned", async () => {
    const view = await curriculum(
      new FakeReader(
        weekly({
          calendar: { weeks: 1, startsOn: "2026-09-27" },
          tracks: [track("t1", { week: 1 }), track("t2", { position: 2, week: 2 })],
        }),
      ),
    ).execute(USER, MISSION, TZ);
    expect(view.modules[0]!.week?.index).toBe(1);
    expect(view.modules[1]!.week).toBeNull();

    const unpinned = await curriculum(
      new FakeReader(weekly({ tracks: [track("t1"), track("t2", { position: 2 })] })),
    ).execute(USER, MISSION, TZ);
    expect(unpinned.modules[0]!.week).toBeNull();
  });

  it("dates a finished week from the local day the module was finished", async () => {
    const view = await curriculum(
      new FakeReader(
        weekly({
          tracks: [track("t1", { week: 1 })],
          lessons: [...five("t1", 5)],
          exams: [
            exam("t1", {
              items: [
                {
                  key: "a",
                  covers: [],
                  grading: "checked",
                  // 01:00 UTC on Oct 3 is still Oct 2 in São Paulo: the exam day, on time.
                  attempts: [{ createdAt: new Date("2026-10-03T01:00:00Z"), passed: true }],
                },
              ],
            }),
          ],
        }),
      ),
    ).execute(USER, MISSION, TZ);

    expect(view.modules[0]!.week!.standing).toEqual({ kind: "finished", daysLate: 0 });
  });
});
