import { describe, expect, it } from "vitest";
import { ActivityGridQuerySchema, BacklogQuerySchema, MAX_GRID_DAYS } from "./insights.js";

describe("ActivityGridQuerySchema", () => {
  it("defaults to the focus layer", () => {
    expect(ActivityGridQuerySchema.parse({ from: "2026-01-01", to: "2026-12-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
      layer: "focus",
    });
  });

  it("accepts a single day", () => {
    expect(
      ActivityGridQuerySchema.safeParse({ from: "2026-08-07", to: "2026-08-07" }).success,
    ).toBe(true);
  });

  it("refuses a range that runs backwards", () => {
    expect(
      ActivityGridQuerySchema.safeParse({ from: "2026-08-09", to: "2026-08-07" }).success,
    ).toBe(false);
  });

  it("refuses a range longer than a year and a bit", () => {
    const from = "2026-01-01";
    expect(ActivityGridQuerySchema.safeParse({ from, to: "2027-01-31" }).success).toBe(true);
    expect(ActivityGridQuerySchema.safeParse({ from, to: "2030-01-01" }).success).toBe(false);
    expect(MAX_GRID_DAYS).toBeGreaterThan(365);
  });

  it("refuses a layer that has no source table yet", () => {
    // §3.9 names five layers and three have no data until M4–M6. A 422 beats a screen of zeroes
    // claiming you completed no reviews.
    for (const layer of ["reviews", "lessons", "artifacts"]) {
      expect(
        ActivityGridQuerySchema.safeParse({ from: "2026-08-01", to: "2026-08-07", layer }).success,
      ).toBe(false);
    }
    expect(
      ActivityGridQuerySchema.safeParse({ from: "2026-08-01", to: "2026-08-07", layer: "notes" })
        .success,
    ).toBe(true);
  });
});

describe("BacklogQuerySchema", () => {
  it("defaults to four weeks, matching the activity grid's own window", () => {
    expect(BacklogQuerySchema.parse({})).toEqual({ windowDays: 28 });
  });

  it("coerces and bounds the window a query string sends", () => {
    expect(BacklogQuerySchema.parse({ windowDays: "90" })).toEqual({ windowDays: 90 });
    expect(BacklogQuerySchema.safeParse({ windowDays: 1 }).success).toBe(false);
    expect(BacklogQuerySchema.safeParse({ windowDays: 400 }).success).toBe(false);
  });
});
