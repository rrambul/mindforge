import { describe, expect, it } from "vitest";
import {
  AllocationSchema,
  CompleteWeeklyReviewSchema,
  IsoDateSchema,
  MAX_PLANNED_MINUTES,
  PutWeeklyPlanSchema,
} from "./planning.js";

const MISSION = "aaaaaaaa-0000-4000-8000-000000000001";
const SKILL = "bbbbbbbb-0000-4000-8000-000000000001";

describe("IsoDateSchema", () => {
  it("accepts a real date", () => {
    expect(IsoDateSchema.parse("2026-08-03")).toBe("2026-08-03");
  });

  it("keeps it a string rather than coercing to a Date", () => {
    // The whole point. Coercing gives the date a UTC midnight it does not have, which is how
    // 2026-08-03 becomes 2026-08-02 for everyone west of Greenwich the first time it is formatted.
    expect(typeof IsoDateSchema.parse("2026-08-03")).toBe("string");
  });

  it("rejects a date that does not exist and anything that is not one", () => {
    expect(IsoDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(IsoDateSchema.safeParse("2026-8-3").success).toBe(false);
    expect(IsoDateSchema.safeParse("2026-08-03T00:00:00Z").success).toBe(false);
  });
});

describe("AllocationSchema", () => {
  it("accepts one against a mission and one against a skill", () => {
    expect(AllocationSchema.parse({ missionId: MISSION, plannedMinutes: 240 })).toMatchObject({
      missionId: MISSION,
      plannedMinutes: 240,
    });
    expect(AllocationSchema.parse({ skillId: SKILL, plannedMinutes: 60 })).toMatchObject({
      skillId: SKILL,
    });
  });

  it("refuses both subjects and neither, matching the table's check constraint", () => {
    expect(
      AllocationSchema.safeParse({ missionId: MISSION, skillId: SKILL, plannedMinutes: 60 })
        .success,
    ).toBe(false);
    expect(AllocationSchema.safeParse({ plannedMinutes: 60 }).success).toBe(false);
    expect(
      AllocationSchema.safeParse({ missionId: null, skillId: null, plannedMinutes: 60 }).success,
    ).toBe(false);
  });

  it("refuses zero minutes", () => {
    // Zero is the absence of an allocation, not an allocation of nothing. The grid deletes the row.
    expect(AllocationSchema.safeParse({ missionId: MISSION, plannedMinutes: 0 }).success).toBe(
      false,
    );
  });

  it("refuses a target nobody could hit", () => {
    expect(
      AllocationSchema.safeParse({ missionId: MISSION, plannedMinutes: MAX_PLANNED_MINUTES + 1 })
        .success,
    ).toBe(false);
    expect(
      AllocationSchema.safeParse({ missionId: MISSION, plannedMinutes: MAX_PLANNED_MINUTES })
        .success,
    ).toBe(true);
  });

  it("coerces the minutes a form sends as a string", () => {
    expect(AllocationSchema.parse({ missionId: MISSION, plannedMinutes: "90" })).toMatchObject({
      plannedMinutes: 90,
    });
  });
});

describe("PutWeeklyPlanSchema", () => {
  it("accepts an empty week, which is how you clear a plan", () => {
    expect(PutWeeklyPlanSchema.parse({ allocations: [] })).toEqual({ allocations: [] });
  });

  it("refuses an implausibly long plan", () => {
    const many = Array.from({ length: 51 }, () => ({ missionId: MISSION, plannedMinutes: 30 }));
    expect(PutWeeklyPlanSchema.safeParse({ allocations: many }).success).toBe(false);
  });
});

describe("CompleteWeeklyReviewSchema", () => {
  it("accepts a review that changed nothing", () => {
    // A week where nothing needs changing is a real answer, and forcing a sentence produces a
    // fabricated one.
    expect(CompleteWeeklyReviewSchema.parse({})).toEqual({});
  });

  it("accepts the one thing and a note", () => {
    expect(
      CompleteWeeklyReviewSchema.parse({ changedOneThing: "  Mornings only  ", note: "why" }),
    ).toEqual({ changedOneThing: "Mornings only", note: "why" });
  });

  it("refuses an empty string, which is a form field nobody filled in", () => {
    expect(CompleteWeeklyReviewSchema.safeParse({ changedOneThing: "   " }).success).toBe(false);
  });
});
