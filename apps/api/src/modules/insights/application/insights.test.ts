import { addDays, type ActivityDay, type IsoDate } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActivityGridReader, ActivityRows, DayRange } from "./activity-grid.port.js";
import { GetActivityGrid } from "./insights.use-cases.js";

const ALICE = "11111111-1111-4111-8111-111111111111";

const TODAY: IsoDate = "2026-08-05";

class InMemoryActivity implements ActivityGridReader {
  days: ActivityDay[] = [];
  rebuiltAt: Date | null = null;

  daysIn(_userId: string, range: DayRange): Promise<ActivityRows> {
    return Promise.resolve({
      days: this.days.filter((day) => day.day >= range.from && day.day <= range.to),
      rebuiltAt: this.rebuiltAt,
    });
  }
}

function activeDay(day: IsoDate, focusMinutes: number): ActivityDay {
  return { day, focusMinutes };
}

describe("GetActivityGrid (FR-Q1)", () => {
  let activity: InMemoryActivity;
  let grid: GetActivityGrid;

  beforeEach(() => {
    activity = new InMemoryActivity();
    grid = new GetActivityGrid(activity);
  });

  const range = { from: addDays(TODAY, -27), to: TODAY };

  it("draws a cell for every day in the range, including the empty ones", async () => {
    activity.days = [activeDay(TODAY, 45)];

    const result = await grid.execute(ALICE, range);

    expect(result.grid.cells).toHaveLength(28);
    expect(result.grid.cells.at(-1)).toMatchObject({ day: TODAY, value: 45 });
    expect(result.grid.cells[0]).toMatchObject({ value: 0, intensity: 0 });
  });

  it("counts active days over the range it was asked about", async () => {
    activity.days = [-1, -2, -3, -40].map((offset) => activeDay(addDays(TODAY, offset), 75));

    const result = await grid.execute(ALICE, range);

    // The day outside the range never reaches the grid; three of the four count.
    expect(result.grid.activeDaysIn28).toBe(3);
  });

  it("reports when the rollup last wrote the range", async () => {
    const rebuilt = new Date("2026-08-05T03:00:00Z");
    activity.rebuiltAt = rebuilt;

    expect((await grid.execute(ALICE, range)).rebuiltAt).toBe(rebuilt);
  });

  it("reports null when the range holds no rows", async () => {
    // "You did nothing in March" and "March has never been rolled up" are different answers, and
    // this is the only field that can tell them apart.
    expect((await grid.execute(ALICE, range)).rebuiltAt).toBeNull();
  });
});
