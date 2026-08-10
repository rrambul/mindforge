import { describe, expect, it } from "vitest";

import {
  CompleteLessonSchema,
  LESSON_OUTCOMES,
  LessonOutcomeSchema,
  asLessonOutcome,
} from "./lesson.js";

describe("lesson outcomes", () => {
  it("accepts the three the reader can write", () => {
    for (const outcome of LESSON_OUTCOMES) {
      expect(LessonOutcomeSchema.parse(outcome)).toBe(outcome);
    }
  });

  it("rejects anything else, including the empty string a blank control would send", () => {
    expect(LessonOutcomeSchema.safeParse("done").success).toBe(false);
    expect(LessonOutcomeSchema.safeParse("").success).toBe(false);
  });

  it("requires an outcome to complete a lesson", () => {
    expect(CompleteLessonSchema.safeParse({}).success).toBe(false);
    expect(CompleteLessonSchema.safeParse({ outcome: null }).success).toBe(false);
    expect(CompleteLessonSchema.parse({ outcome: "shaky" })).toEqual({ outcome: "shaky" });
  });
});

describe("asLessonOutcome", () => {
  it("passes through the three the column may hold", () => {
    for (const outcome of LESSON_OUTCOMES) {
      expect(asLessonOutcome(outcome)).toBe(outcome);
    }
  });

  it("reads anything else as no outcome recorded", () => {
    // A row written around the CHECK constraint. Passed through, a fourth value
    // reaches the SPA as a translation key that does not exist and renders as the
    // raw string.
    expect(asLessonOutcome("done")).toBeNull();
    expect(asLessonOutcome("")).toBeNull();
    expect(asLessonOutcome(null)).toBeNull();
  });
});
