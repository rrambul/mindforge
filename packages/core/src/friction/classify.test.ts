import { describe, expect, it } from "vitest";
import { classifyFriction, frictionSplit, type FrictionType } from "./classify.js";

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

describe("frictionSplit", () => {
  it("reports null ember share when nothing was logged, not zero", () => {
    // Zero would read as "all your friction was wasted", which is a claim we
    // have no evidence for.
    expect(frictionSplit([]).emberShare).toBeNull();
  });

  it("splits minutes by class", () => {
    const result = frictionSplit([
      { type: "productive_struggle", minutes: 30, outcome: didnt },
      { type: "tooling", minutes: 10, outcome: didnt },
    ]);
    expect(result.productiveMinutes).toBe(30);
    expect(result.wastefulMinutes).toBe(10);
    expect(result.emberShare).toBeCloseTo(0.75, 10);
  });

  it("counts a pushed-through hard stretch as ember", () => {
    const result = frictionSplit([{ type: "too_hard", minutes: 45, outcome: learned }]);
    expect(result.emberShare).toBe(1);
  });

  it("counts an abandoned hard stretch as slag", () => {
    const result = frictionSplit([{ type: "too_hard", minutes: 45, outcome: didnt }]);
    expect(result.emberShare).toBe(0);
  });

  it("rejects negative minutes rather than silently skewing the ratio", () => {
    expect(() => frictionSplit([{ type: "tooling", minutes: -5, outcome: didnt }])).toThrow(
      RangeError,
    );
  });
});
