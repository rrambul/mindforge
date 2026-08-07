import { describe, expect, it } from "vitest";
import { classifyFriction, type FrictionType } from "./classify.js";

const learned = { producedLearning: true };
const didnt = { producedLearning: false };

describe("classifyFriction", () => {
  it("always counts productive struggle as productive", () => {
    expect(classifyFriction("productive_struggle", learned)).toBe("productive");
    expect(classifyFriction("productive_struggle", didnt)).toBe("productive");
  });

  it("counts 'too hard' as productive only when the session still taught you something", () => {
    // This is the whole distinction: difficulty you pushed through is desirable,
    // difficulty that ended the session is a ZPD miss.
    expect(classifyFriction("too_hard", learned)).toBe("productive");
    expect(classifyFriction("too_hard", didnt)).toBe("wasteful");
  });

  it("applies the same rule to a missing prerequisite", () => {
    expect(classifyFriction("missing_prerequisite", learned)).toBe("productive");
    expect(classifyFriction("missing_prerequisite", didnt)).toBe("wasteful");
  });

  it.each<FrictionType>([
    "interruption",
    "self_interruption",
    "too_easy",
    "unclear_material",
    "tooling",
    "decision_fatigue",
    "avoidance",
    "physical",
  ])("counts %s as wasteful even when the session produced learning", (type) => {
    // A broken build tool is never desirable difficulty, however the day ended.
    expect(classifyFriction(type, learned)).toBe("wasteful");
  });
});
