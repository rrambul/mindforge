import { describe, expect, it } from "vitest";
import { addDays, eachDay } from "../time/calendar.js";
import { buildGrid, type ActivityDay } from "./activity-grid.js";

function day(partial: Partial<ActivityDay> & { day: string }): ActivityDay {
  return { focusMinutes: 0, ...partial };
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

  it("gives an empty day intensity zero", () => {
    // An empty cell is neutral. Rest days are part of the design, and there is no shading of shame.
    const grid = buildGrid([], { from: "2026-08-03", to: "2026-08-09" });
    expect(grid.cells.every((c) => c.intensity === 0 && c.value === 0)).toBe(true);
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

  it("counts active days over the last 28 only, however long the grid is", () => {
    const rows = [
      day({ day: "2026-01-05", focusMinutes: 60 }),
      day({ day: "2026-08-05", focusMinutes: 60 }),
    ];
    expect(buildGrid(rows, { from: "2026-01-01", to: "2026-08-07" }).activeDaysIn28).toBe(1);
  });

  describe("signal", () => {
    /** `count` active days spread one per day from `from`, so no weekday is ever missed. */
    function spread(count: number, from: string): ActivityDay[] {
      return Array.from({ length: count }, (_, i) =>
        day({ day: addDays(from, i), focusMinutes: 60 }),
      );
    }

    it("says nothing about a short window", () => {
      // Eight Saturdays is a pattern. One is a weekend.
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

    it("stays quiet when every weekday has appeared", () => {
      const grid = buildGrid(spread(14, "2026-06-01"), { from: "2026-06-01", to: "2026-08-07" });
      expect(grid.signal).toBeNull();
    });
  });
});
