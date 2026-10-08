import { describe, expect, it } from "vitest";

import {
  estimateModule,
  median,
  MIN_TIMED_LESSONS,
  PACE_WINDOW_DAYS,
  paceWindowDays,
  projectSchedule,
  schedulePace,
  type ModuleWork,
  type PaceResult,
} from "./estimate.js";

const TODAY = "2026-10-02";

function known(minutesPerLesson: number, minutesPerDay: number): PaceResult {
  return {
    status: "known",
    pace: { minutesPerLesson, minutesPerDay, timedLessons: 3, windowDays: PACE_WINDOW_DAYS },
  };
}

function work(overrides: Partial<ModuleWork> & { id: string }): ModuleWork {
  return { planned: true, remainingLessons: 0, examPassed: false, ...overrides };
}

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([40, 10, 20, 30])).toBe(25);
  });
});

describe("paceWindowDays", () => {
  it("counts every day since the mission's first, today included", () => {
    // Created Monday, read on Wednesday: three days, not 28. Over 28, 72 minutes
    // was 2.6 a day and a week's exam landed two months out.
    expect(paceWindowDays("2026-10-05", "2026-10-07")).toBe(3);
    expect(paceWindowDays("2026-10-07", "2026-10-07")).toBe(1);
  });

  it("stops at the 28-day window for an older mission", () => {
    expect(paceWindowDays("2026-01-01", "2026-10-07")).toBe(PACE_WINDOW_DAYS);
  });

  it("is never zero days, even for a first day after today", () => {
    expect(paceWindowDays("2026-10-09", "2026-10-07")).toBe(1);
  });
});

describe("schedulePace", () => {
  it("is the median minutes per timed lesson and the 28-day minutes per day", () => {
    expect(schedulePace({ lessonMinutes: [20, 60, 40, 30], recentMinutes: 280 })).toEqual({
      status: "known",
      pace: { minutesPerLesson: 35, timedLessons: 4, minutesPerDay: 10, windowDays: 28 },
    });
  });

  it("leaves out lessons with no time bound to them rather than counting them as zero", () => {
    const pace = schedulePace({ lessonMinutes: [0, 0, 30, 40, 50], recentMinutes: 28 });
    expect(pace).toMatchObject({
      status: "known",
      pace: { minutesPerLesson: 40, timedLessons: 3 },
    });
  });

  it("refuses to guess with too few timed lessons, and says how many it has", () => {
    expect(schedulePace({ lessonMinutes: [30, 40], recentMinutes: 100 })).toEqual({
      status: "unknown",
      missing: ["timed-lessons"],
      timedLessons: 2,
    });
    expect(MIN_TIMED_LESSONS).toBe(3);
  });

  it("refuses to guess with no recent time, and can say both at once", () => {
    expect(schedulePace({ lessonMinutes: [30, 40, 50], recentMinutes: 0 })).toEqual({
      status: "unknown",
      missing: ["recent-time"],
      timedLessons: 3,
    });
    expect(schedulePace({ lessonMinutes: [], recentMinutes: 0, windowDays: 7 })).toEqual({
      status: "unknown",
      missing: ["timed-lessons", "recent-time"],
      timedLessons: 0,
    });
  });
});

describe("projectSchedule", () => {
  it("counts the exam as one more lesson and rounds days up", () => {
    // 2 lessons + the exam = 3 units × 30 min = 90 min at 20 min/day = 4.5 days → 5 days.
    const projection = estimateModule(work({ id: "m", remainingLessons: 2 }), known(30, 20), TODAY);

    expect(projection).toEqual({
      status: "projected",
      units: 3,
      minutes: 90,
      startDay: "2026-10-02",
      examDay: "2026-10-06",
    });
  });

  it("schedules a lone exam inside today when a day's pace covers it", () => {
    expect(estimateModule(work({ id: "m" }), known(30, 60), TODAY)).toMatchObject({
      examDay: TODAY,
      units: 1,
    });
  });

  it("is finished when every lesson is done and the exam passed", () => {
    expect(estimateModule(work({ id: "m", examPassed: true }), known(30, 20), TODAY)).toEqual({
      status: "finished",
    });
  });

  it("chains modules, each starting where the last is projected to end", () => {
    const schedule = projectSchedule(
      [
        work({ id: "done", examPassed: true }),
        // 1 lesson + exam = 60 min at 40/day = 1.5 days → ends day 2 (Oct 3).
        work({ id: "a", remainingLessons: 1 }),
        // 60 more min → 3.0 days cumulative → ends Oct 4, starts Oct 3 (floor 1.5).
        work({ id: "b", remainingLessons: 1 }),
      ],
      known(30, 40),
      TODAY,
    );

    expect(schedule.get("done")).toEqual({ status: "finished" });
    expect(schedule.get("a")).toMatchObject({ startDay: "2026-10-02", examDay: "2026-10-03" });
    expect(schedule.get("b")).toMatchObject({ startDay: "2026-10-03", examDay: "2026-10-04" });
  });

  it("breaks the chain at an unplanned module, and keeps what came before", () => {
    const schedule = projectSchedule(
      [
        work({ id: "a", remainingLessons: 1 }),
        work({ id: "unplanned", planned: false }),
        work({ id: "after", remainingLessons: 3 }),
        work({ id: "finished", examPassed: true }),
      ],
      known(30, 30),
      TODAY,
    );

    expect(schedule.get("a")).toMatchObject({ status: "projected" });
    expect(schedule.get("unplanned")).toEqual({ status: "unknown", reason: "not-planned" });
    expect(schedule.get("after")).toEqual({ status: "unknown", reason: "after-unplanned" });
    expect(schedule.get("finished")).toEqual({ status: "finished" });
  });

  it("leaves a dropped module out of the chain without breaking it", () => {
    const schedule = projectSchedule(
      [
        work({ id: "dropped", dropped: true, planned: false, remainingLessons: 4 }),
        work({ id: "a", remainingLessons: 1 }),
      ],
      known(30, 60),
      TODAY,
    );

    expect(schedule.get("dropped")).toEqual({ status: "unknown", reason: "dropped" });
    expect(schedule.get("a")).toMatchObject({
      status: "projected",
      startDay: TODAY,
      examDay: TODAY,
    });
  });

  it("has no projection without a pace", () => {
    const pace = schedulePace({ lessonMinutes: [], recentMinutes: 0 });
    expect(estimateModule(work({ id: "m", remainingLessons: 2 }), pace, TODAY)).toEqual({
      status: "unknown",
      reason: "no-pace",
    });
  });
});
