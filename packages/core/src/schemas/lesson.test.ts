import { describe, expect, it } from "vitest";

import { CompleteLessonSchema, LESSON_OUTCOMES, LessonOutcomeSchema } from "./lesson.js";

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
