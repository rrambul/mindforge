import { describe, expect, it } from "vitest";

import {
  firstWeekStart,
  isWeekStart,
  lessonDays,
  lessonDueOn,
  missionEndsOn,
  pinWeeks,
  weeklyShapeGaps,
  weekOf,
  weekStanding,
} from "./weeks.js";

// 2026-10-05 is a Monday.
const MONDAY = "2026-10-05";

describe("firstWeekStart", () => {
  it("is today when today starts a week, and the next week start otherwise", () => {
    expect(firstWeekStart(MONDAY, 1)).toBe(MONDAY);
    expect(firstWeekStart("2026-10-01", 1)).toBe(MONDAY); // a Thursday
    expect(firstWeekStart("2026-10-04", 0)).toBe("2026-10-04"); // a Sunday, Sunday weeks
    expect(firstWeekStart("2026-10-04", 1)).toBe(MONDAY);
  });

  it("knows a week start when it sees one", () => {
    expect(isWeekStart(MONDAY, 1)).toBe(true);
    expect(isWeekStart(MONDAY, 0)).toBe(false);
  });
});

describe("the calendar", () => {
  it("puts lessons on days 1–5, the exam on day 6, rest on day 7", () => {
    const week = weekOf(MONDAY, 2);

    expect(week).toEqual({
      index: 2,
      startsOn: "2026-10-12",
      examOn: "2026-10-17",
      endsOn: "2026-10-18",
    });
    expect(lessonDueOn(week, 1)).toBe("2026-10-12");
    expect(lessonDueOn(week, 5)).toBe("2026-10-16");
  });

  it("files a sixth day on day 5, never on the exam day", () => {
    expect(lessonDueOn(weekOf(MONDAY, 1), 6)).toBe("2026-10-09");
    expect(lessonDueOn(weekOf(MONDAY, 1), 0)).toBe(MONDAY);
  });

  it("ends a mission on the rest day of its last week", () => {
    expect(missionEndsOn(MONDAY, 3)).toBe("2026-10-25");
  });
});

describe("pinWeeks — a module keeps the week it was first given", () => {
  it("gives unassigned modules the next weeks, in plan order", () => {
    const pinned = pinWeeks([
      { id: "b", week: null, position: 2, dropped: false },
      { id: "a", week: null, position: 1, dropped: false },
    ]);
    expect([...pinned]).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("never moves a week already given, and never reuses one — a dropped module keeps its slot", () => {
    // A revision dropped week 1 and put a new module first in the plan.
    const pinned = pinWeeks([
      { id: "new", week: null, position: 1, dropped: false },
      { id: "old-1", week: 1, position: 9, dropped: true },
      { id: "old-2", week: 2, position: 2, dropped: false },
    ]);
    expect([...pinned]).toEqual([["new", 3]]);
  });

  it("gives a dropped module no new week", () => {
    expect(pinWeeks([{ id: "gone", week: null, position: 1, dropped: true }]).size).toBe(0);
  });
});

describe("lessonDays — the plan's own order, not the easiest-first one", () => {
  it("numbers lessons 1–5 by their row in the plan", () => {
    const days = lessonDays([
      { id: "c", position: 3 },
      { id: "a", position: 1 },
      { id: "b", position: 2 },
    ]);
    expect([...days]).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("gives an off-plan lesson — a bridge — no day", () => {
    const days = lessonDays([
      { id: "a", position: 1 },
      { id: "bridge", position: null },
    ]);
    expect(days.has("bridge")).toBe(false);
  });

  it("puts a sixth planned lesson on day 5", () => {
    const days = lessonDays(
      Array.from({ length: 6 }, (_, i) => ({ id: `l${i + 1}`, position: i + 1 })),
    );
    expect(days.get("l6")).toBe(5);
  });
});

describe("weekStanding", () => {
  const week = weekOf(MONDAY, 1);
  const progress = (completed: boolean[], finishedOn: string | null = null) => ({
    week,
    lessons: completed.map((done, i) => ({ day: i + 1, completed: done })),
    finishedOn,
  });

  it("says a week with no lessons planned is not planned — not on track, not done", () => {
    for (const today of ["2026-10-02", "2026-10-07", "2026-10-20"]) {
      expect(weekStanding({ week, lessons: [], finishedOn: null }, today)).toEqual({
        kind: "not-planned",
      });
    }
    // Off-plan lessons have no day, so they do not make a week planned.
    expect(
      weekStanding(
        { week, lessons: [{ day: null, completed: true }], finishedOn: null },
        "2026-10-07",
      ),
    ).toEqual({ kind: "not-planned" });
  });

  it("is upcoming before the week starts", () => {
    expect(weekStanding(progress([false, false]), "2026-10-02")).toEqual({
      kind: "upcoming",
      startsInDays: 3,
    });
  });

  it("counts as behind only the lessons from earlier days, and today's as due today", () => {
    // Wednesday: Monday's done, Tuesday's not, Wednesday's is today's.
    expect(weekStanding(progress([true, false, false, false, false]), "2026-10-07")).toEqual({
      kind: "in-progress",
      total: 5,
      completed: 1,
      behind: 1,
      dueToday: 1,
      examToday: false,
    });
  });

  it("is not behind at 8am on day 1 with nothing missed", () => {
    expect(weekStanding(progress([false, false, false, false, false]), MONDAY)).toMatchObject({
      behind: 0,
      dueToday: 1,
    });
  });

  it("is on track — zero behind, nothing due today — having worked ahead", () => {
    expect(weekStanding(progress([true, true, true, false, false]), "2026-10-06")).toMatchObject({
      behind: 0,
      dueToday: 0,
      completed: 3,
    });
  });

  it("says when today is the exam day", () => {
    expect(weekStanding(progress([true, true, true, true, true]), "2026-10-10")).toMatchObject({
      kind: "in-progress",
      examToday: true,
      behind: 0,
    });
  });

  it("is overdue from the day after the rest day, with what is left of how many", () => {
    expect(weekStanding(progress([true, true, false, false, false]), "2026-10-13")).toEqual({
      kind: "overdue",
      daysOver: 2,
      lessonsLeft: 3,
      total: 5,
    });
  });

  it("is finished on time on or before the exam day, and late by the days after it", () => {
    expect(weekStanding(progress([true], "2026-10-08"), "2026-10-20")).toEqual({
      kind: "finished",
      daysLate: 0,
    });
    expect(weekStanding(progress([true], "2026-10-13"), "2026-10-20")).toEqual({
      kind: "finished",
      daysLate: 3,
    });
  });
});

describe("weeklyShapeGaps", () => {
  it("is null for one module per week of five lessons each", () => {
    expect(weeklyShapeGaps(2, [5, 5])).toBeNull();
  });

  it("names the module count and the weeks whose lesson count is off", () => {
    expect(weeklyShapeGaps(3, [5, 4, 5, 6])).toEqual({ modules: 4, offModules: [2, 4] });
    expect(weeklyShapeGaps(3, [5, 5])).toEqual({ modules: 2, offModules: [] });
  });
});
