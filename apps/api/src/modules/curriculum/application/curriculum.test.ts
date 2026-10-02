import { FixedClock, type DeadlineRow } from "@mindforge/core";
import { describe, expect, it } from "vitest";

import { DeadlineInPast, ModuleDropped, ModuleFinished, ModuleNotFound } from "../domain/errors.js";
import type {
  CurriculumReader,
  CurriculumRows,
  ExamRow,
  LessonRow,
  PaceRows,
  TrackRow,
} from "./curriculum.port.js";
import type { DeadlineWriter } from "./deadline.port.js";
import { GetCurriculum } from "./get-curriculum.js";
import { SetDeadline } from "./set-deadline.js";

/**
 * The curriculum's read side and the one write beside it (FR-K5, FR-E6, FR-U1–U5).
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

class FakeWriter implements DeadlineWriter {
  readonly appended: { trackId: string; dueOn: string }[] = [];
  constructor(private readonly reader: FakeReader) {}

  append(_userId: string, trackId: string, dueOn: string): Promise<void> {
    this.appended.push({ trackId, dueOn });
    // Behave like the table: the next read sees the row.
    const rows = this.reader.rows!;
    const history = [...(rows.deadlines.get(trackId) ?? []), { dueOn, createdAt: NOW }];
    this.reader.rows = { ...rows, deadlines: new Map([...rows.deadlines, [trackId, history]]) };
    return Promise.resolve();
  }
}

function rows(over: Partial<CurriculumRows> = {}): CurriculumRows {
  return {
    tracks: [track("t1"), track("t2", { position: 2 })],
    lessons: [lesson("l1", "t1"), lesson("l2", "t2")],
    exams: [],
    deadlines: new Map(),
    pace: NO_PACE,
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

describe("GetCurriculum — the schedule", () => {
  const PACE: PaceRows = { lessonMinutes: [20, 30, 40], recentMinutes: 280 };

  it("says what is missing rather than projecting from nothing", async () => {
    const view = await curriculum(new FakeReader(rows())).execute(USER, MISSION, TZ);

    expect(view.pace).toEqual({
      status: "unknown",
      missing: ["timed-lessons", "recent-time"],
      timedLessons: 0,
    });
    expect(view.modules[0]!.projection).toEqual({ status: "unknown", reason: "no-pace" });
    expect(view.proposal).toEqual({ moduleId: "t1", dueOn: null });
  });

  it("chains modules and proposes the current one's own estimate", async () => {
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
    expect(view.proposal).toEqual({ moduleId: "t1", dueOn: "2026-10-06" });
  });

  it("starts the chain at the module you are in, so the date it proposes is the one it judges", async () => {
    // t1 still has a lesson; t2's lessons are done and its exam is not passed, so t2
    // is the module you are in. Queued behind t1, the date proposed for t2 would be
    // marked "behind" the moment it was accepted.
    const reader = new FakeReader(
      rows({
        pace: PACE,
        lessons: [lesson("l1", "t1"), lesson("l2", "t2", { completedAt: AT })],
      }),
    );
    const view = await curriculum(reader).execute(USER, MISSION, TZ);

    expect(view.currentModuleId).toBe("t2");
    // The exam alone: 30 minutes at 10 a day, 3 days, from today.
    expect(view.modules[1]!.projection).toMatchObject({
      startDay: "2026-10-01",
      examDay: "2026-10-03",
    });
    expect(view.proposal).toEqual({ moduleId: "t2", dueOn: "2026-10-03" });
    // t1 waits behind it.
    expect(view.modules[0]!.projection).toMatchObject({ startDay: "2026-10-04" });

    const set = new SetDeadline(curriculum(reader), new FakeWriter(reader));
    const after = await set.execute(USER, MISSION, "t2", TZ, { dueOn: "2026-10-03" });
    expect(after.modules[1]!.deadline?.status).toEqual({ kind: "on-track", daysLeft: 2 });
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

  it("shows a deadline with its history and status, and stops proposing", async () => {
    const history: DeadlineRow[] = [
      { dueOn: "2026-10-03", createdAt: new Date("2026-09-25T12:00:00Z") },
      { dueOn: "2026-10-05", createdAt: new Date("2026-09-28T12:00:00Z") },
    ];
    const view = await curriculum(
      new FakeReader(rows({ pace: PACE, deadlines: new Map([["t1", history]]) })),
    ).execute(USER, MISSION, TZ);

    expect(view.modules[0]!.deadline).toEqual({
      dueOn: "2026-10-05",
      firstDueOn: "2026-10-03",
      moves: 1,
      // Projected for the 6th, due on the 5th.
      status: { kind: "behind", daysLeft: 4, daysBehind: 1 },
    });
    expect(view.modules[1]!.deadline).toBeNull();
    expect(view.proposal).toBeNull();
  });

  it("dates a finished module's deadline from the local day it was finished", async () => {
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
                  grading: "checked",
                  // 01:00 UTC on the 23rd is the 22nd in São Paulo.
                  attempts: [{ createdAt: new Date("2026-09-23T01:00:00Z"), passed: true }],
                },
              ],
            }),
          ],
          deadlines: new Map([["t1", [{ dueOn: "2026-09-22", createdAt: AT }]]]),
        }),
      ),
    ).execute(USER, MISSION, TZ);

    expect(view.modules[0]!.deadline?.status).toEqual({ kind: "met", daysEarly: 0 });
  });

  it("has no current module, and no proposal, when nothing is left", async () => {
    const view = await curriculum(
      new FakeReader(rows({ tracks: [track("t1")], lessons: [] })),
    ).execute(USER, MISSION, TZ);

    expect(view.currentModuleId).toBeNull();
    expect(view.proposal).toBeNull();
  });
});

describe("SetDeadline", () => {
  function setup(over: Partial<CurriculumRows> = {}) {
    const reader = new FakeReader(rows(over));
    const writer = new FakeWriter(reader);
    return { writer, set: new SetDeadline(curriculum(reader), writer) };
  }

  it("commits a date and answers with the curriculum that shows it", async () => {
    const { writer, set } = setup();

    const view = await set.execute(USER, MISSION, "t1", TZ, { dueOn: "2026-10-10" });

    expect(writer.appended).toEqual([{ trackId: "t1", dueOn: "2026-10-10" }]);
    expect(view.modules[0]!.deadline).toMatchObject({ dueOn: "2026-10-10", moves: 0 });
  });

  it("accepts today — the learner's today — and refuses yesterday", async () => {
    const { set } = setup();

    await expect(
      set.execute(USER, MISSION, "t1", TZ, { dueOn: "2026-10-01" }),
    ).resolves.toBeTruthy();
    await expect(
      set.execute(USER, MISSION, "t1", TZ, { dueOn: "2026-09-30" }),
    ).rejects.toBeInstanceOf(DeadlineInPast);
  });

  it("writes nothing when the date is the one already in force — that is not a move", async () => {
    const { writer, set } = setup({
      deadlines: new Map([["t1", [{ dueOn: "2026-10-10", createdAt: AT }]]]),
    });

    await set.execute(USER, MISSION, "t1", TZ, { dueOn: "2026-10-10" });

    expect(writer.appended).toEqual([]);
  });

  it("refuses a module the curriculum does not show", async () => {
    await expect(
      setup().set.execute(USER, MISSION, "nope", TZ, { dueOn: "2026-10-10" }),
    ).rejects.toBeInstanceOf(ModuleNotFound);
  });

  it("refuses a dropped module", async () => {
    const { set } = setup({
      tracks: [track("t1", { status: "dropped" })],
      lessons: [lesson("l1", "t1", { completedAt: AT })],
    });

    await expect(
      set.execute(USER, MISSION, "t1", TZ, { dueOn: "2026-10-10" }),
    ).rejects.toBeInstanceOf(ModuleDropped);
  });

  it("refuses a finished module, whose date can no longer be met or missed", async () => {
    const { set } = setup({
      lessons: [lesson("l1", "t1", { completedAt: AT })],
      exams: [
        exam("t1", {
          items: [
            {
              key: "a",
              covers: [],
              grading: "checked",
              attempts: [{ createdAt: AT, passed: true }],
            },
          ],
        }),
      ],
    });

    await expect(
      set.execute(USER, MISSION, "t1", TZ, { dueOn: "2026-10-10" }),
    ).rejects.toBeInstanceOf(ModuleFinished);
  });
});
