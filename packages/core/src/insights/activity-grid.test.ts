import { describe, expect, it } from "vitest";
import { addDays, eachDay } from "../time/calendar.js";
import { buildGrid, type ActivityDay } from "./activity-grid.js";

function day(partial: Partial<ActivityDay> & { day: string }): ActivityDay {
  return { focusMinutes: 0, emberMinutes: 0, slagMinutes: 0, notesCaptured: 0, ...partial };
}

describe("buildGrid", () => {
  it("draws a cell for every day in the range, including the empty ones", () => {
    const grid = buildGrid([day({ day: "2026-08-05", focusMinutes: 60 })], {
      from: "2026-08-03",
      to: "2026-08-09",
    });
    expect(grid.cells).toHaveLength(7);
    expect(grid.cells.map((c) => c.day)).toEqual(eachDay("2026-08-03", "2026-08-09"));
  });

  it("gives an empty day intensity zero and no hue", () => {
    // An empty cell is neutral. Rest days are part of the design, and there is no shading of shame.
    const grid = buildGrid([], { from: "2026-08-03", to: "2026-08-09" });
    expect(grid.cells.every((c) => c.intensity === 0 && c.emberShare === null)).toBe(true);
  });

  it("leaves the hue null on a day with focus but no logged friction", () => {
    // Grey means "you spent this and got little", which is a measurement. A day you did not
    // annotate has not been measured, and rendering it grey would be a lie about it.
    const grid = buildGrid([day({ day: "2026-08-05", focusMinutes: 120 })], {
      from: "2026-08-05",
      to: "2026-08-05",
    });
    expect(grid.cells[0]).toMatchObject({ value: 120, emberShare: null });
    expect(grid.cells[0]!.intensity).toBeGreaterThan(0);
  });

  it("takes hue from the day's ember share", () => {
    const grid = buildGrid(
      [day({ day: "2026-08-05", focusMinutes: 60, emberMinutes: 45, slagMinutes: 15 })],
      { from: "2026-08-05", to: "2026-08-05" },
    );
    expect(grid.cells[0]!.emberShare).toBe(0.75);
  });

  it("keeps the hue when the layer changes", () => {
    // A day's temper is a fact about the day. Dimming it on the notes layer would imply the
    // note-taking was the slag.
    const rows = [day({ day: "2026-08-05", focusMinutes: 60, emberMinutes: 60, notesCaptured: 3 })];
    const focus = buildGrid(rows, { from: "2026-08-05", to: "2026-08-05", layer: "focus" });
    const notes = buildGrid(rows, { from: "2026-08-05", to: "2026-08-05", layer: "notes" });
    expect(notes.cells[0]!.value).toBe(3);
    expect(notes.cells[0]!.emberShare).toBe(focus.cells[0]!.emberShare);
  });

  it("scales intensity to your own history, not to an absolute", () => {
    // Four days of 10, 20, 30 and 40 minutes must use all four steps. On an absolute scale this
    // whole year would render as the palest shade, which says nothing and reads as failure.
    const grid = buildGrid(
      [
        day({ day: "2026-08-03", focusMinutes: 10 }),
        day({ day: "2026-08-04", focusMinutes: 20 }),
        day({ day: "2026-08-05", focusMinutes: 30 }),
        day({ day: "2026-08-06", focusMinutes: 40 }),
      ],
      { from: "2026-08-03", to: "2026-08-06" },
    );
    expect(grid.cells.map((c) => c.intensity)).toEqual([1, 2, 3, 4]);
  });

  it("gives a single non-empty day the lowest non-zero step", () => {
    const grid = buildGrid([day({ day: "2026-08-05", focusMinutes: 300 })], {
      from: "2026-08-03",
      to: "2026-08-09",
    });
    expect(grid.cells.find((c) => c.day === "2026-08-05")!.intensity).toBe(1);
  });

  it("gives identical days identical intensity", () => {
    const rows = eachDay("2026-08-03", "2026-08-09").map((d) => day({ day: d, focusMinutes: 45 }));
    const grid = buildGrid(rows, { from: "2026-08-03", to: "2026-08-09" });
    expect(new Set(grid.cells.map((c) => c.intensity))).toEqual(new Set([1]));
  });

  it("counts active days on focus whatever layer is drawn", () => {
    // "Active" is a statement about whether you showed up. Switching to the notes layer must not
    // change the answer.
    const rows = [
      day({ day: "2026-08-05", focusMinutes: 60 }),
      day({ day: "2026-08-06", notesCaptured: 4 }),
    ];
    for (const layer of ["focus", "notes"] as const) {
      expect(buildGrid(rows, { from: "2026-08-01", to: "2026-08-07", layer }).activeDaysIn28).toBe(
        1,
      );
    }
  });

  it("counts active days over the last 28 only, however long the grid is", () => {
    const rows = [
      day({ day: "2026-01-05", focusMinutes: 60 }),
      day({ day: "2026-08-05", focusMinutes: 60 }),
    ];
    expect(buildGrid(rows, { from: "2026-01-01", to: "2026-08-07" }).activeDaysIn28).toBe(1);
  });

  describe("signal", () => {
    /** `count` active days spread one per week, so no weekday is ever missed. */
    function spread(count: number, from: string): ActivityDay[] {
      return Array.from({ length: count }, (_, i) =>
        day({ day: addDays(from, i), focusMinutes: 60 }),
      );
    }

    it("says nothing about a short window", () => {
      // Four Saturdays is a pattern. One is a weekend.
      const grid = buildGrid(spread(7, "2026-08-01"), { from: "2026-08-01", to: "2026-08-14" });
      expect(grid.signal).toBeNull();
    });

    it("names a weekday you have never once logged", () => {
      // The fact the grid is genuinely good at surfacing, and that no other view would tell you.
      const everyDayButSaturday = eachDay("2026-06-01", "2026-08-07")
        .filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 6)
        .map((d) => day({ day: d, focusMinutes: 60 }));

      const grid = buildGrid(everyDayButSaturday, { from: "2026-06-01", to: "2026-08-07" });
      expect(grid.signal).toEqual({ kind: "never_on_weekday", weekday: 6 });
    });

    it("stays quiet about a missing weekday on a thin history", () => {
      const grid = buildGrid(spread(6, "2026-06-01"), { from: "2026-06-01", to: "2026-08-07" });
      expect(grid.signal).toBeNull();
    });

    it("names a pace well below what the plan assumes", () => {
      // §3.9's own example: "your last four weeks average 3.2 active days; your plans assume 5".
      const twoPerWeek = [
        "2026-07-13",
        "2026-07-16",
        "2026-07-20",
        "2026-07-23",
        "2026-07-27",
        "2026-07-30",
        "2026-08-03",
        "2026-08-06",
      ].map((d) => day({ day: d, focusMinutes: 60 }));

      const grid = buildGrid(twoPerWeek, {
        from: "2026-06-01",
        to: "2026-08-07",
        plannedDaysPerWeek: 5,
      });
      expect(grid.signal).toEqual({
        kind: "pace_below_plan",
        averageActiveDays: 2,
        plannedDays: 5,
      });
    });

    it("stays quiet when the pace is merely a little short", () => {
      // A line every week about missing a plan by half a day is the nagging FR-N4 exists to prevent.
      const grid = buildGrid(spread(30, "2026-07-09"), {
        from: "2026-06-01",
        to: "2026-08-07",
        plannedDaysPerWeek: 7,
      });
      expect(grid.signal).toBeNull();
    });

    it("says nothing about pace when there is no plan", () => {
      const rows = spread(8, "2026-07-13");
      const range = { from: "2026-06-01", to: "2026-08-07" } as const;

      expect(buildGrid(rows, range).signal).toBeNull();
      expect(buildGrid(rows, { ...range, plannedDaysPerWeek: null }).signal).toBeNull();
      // Zero rather than null is what a user who cleared the field sends, and dividing by it would
      // make every week fall short of nothing.
      expect(buildGrid(rows, { ...range, plannedDaysPerWeek: 0 }).signal).toBeNull();
    });
  });
});
