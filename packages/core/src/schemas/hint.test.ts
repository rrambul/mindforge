import { describe, expect, it } from "vitest";

import { HINT_RUNGS, nextAllowedLevel, RequestHintSchema, rungOf } from "./hint.js";

describe("the ladder", () => {
  it("has five rungs, each giving away more than the last", () => {
    expect(HINT_RUNGS).toEqual(["question", "clue", "concept", "structure", "code"]);
  });

  it("names a rung by its 1-based level, clamped to the ladder", () => {
    expect(rungOf(1)).toBe("question");
    expect(rungOf(5)).toBe("code");
    expect(rungOf(0)).toBe("question");
    expect(rungOf(9)).toBe("code");
  });
});

describe("nextAllowedLevel", () => {
  it("starts at the first rung when nothing has been asked", () => {
    expect(nextAllowedLevel(null)).toBe(1);
  });

  it("allows one rung above the highest so far, never a jump", () => {
    expect(nextAllowedLevel(1)).toBe(2);
    expect(nextAllowedLevel(3)).toBe(4);
  });

  it("stops at the top rung, where asking again is allowed", () => {
    expect(nextAllowedLevel(5)).toBe(5);
  });
});

describe("RequestHintSchema", () => {
  it("defaults to no run and no question", () => {
    expect(RequestHintSchema.parse({ level: 1, code: "" })).toEqual({
      level: 1,
      code: "",
      lastRun: null,
      question: null,
    });
  });

  it("trims a question, and refuses one that is only whitespace", () => {
    expect(RequestHintSchema.parse({ level: 1, code: "", question: "  why?  " }).question).toBe(
      "why?",
    );
    expect(RequestHintSchema.safeParse({ level: 1, code: "", question: "   " }).success).toBe(
      false,
    );
  });

  it.each([0, 6, 2.5])("refuses rung %s", (level) => {
    expect(RequestHintSchema.safeParse({ level, code: "" }).success).toBe(false);
  });
});
