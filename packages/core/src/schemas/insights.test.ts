import { describe, expect, it } from "vitest";
import { ActivityGridQuerySchema, MAX_GRID_DAYS } from "./insights.js";

describe("ActivityGridQuerySchema", () => {
  it("parses a plain range", () => {
    expect(ActivityGridQuerySchema.parse({ from: "2026-01-01", to: "2026-12-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
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

  it("refuses a date that is not a date", () => {
    expect(ActivityGridQuerySchema.safeParse({ from: "yesterday", to: "2026-08-07" }).success).toBe(
      false,
    );
  });
});
