import { describe, expect, it } from "vitest";

import {
  exerciseEvidence,
  lessonStrain,
  nextAdjustment,
  resolveBridges,
  type AdaptableLesson,
  type ExerciseEvidence,
  type JudgedLesson,
  type Strain,
} from "./strain.js";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 24, 10, minute));

const evidence = (over: Partial<ExerciseEvidence> = {}): ExerciseEvidence => ({
  attempted: true,
  passed: true,
  attemptsToPass: 1,
  highestHintBeforePass: null,
  minutesToPass: 4,
  expectedMinutes: 10,
  ...over,
});

describe("exerciseEvidence", () => {
  it("counts attempts up to the first pass, in time order whatever order they arrive in", () => {
    const e = exerciseEvidence({
      expectedMinutes: 10,
      attempts: [
        { createdAt: at(9), passed: true, startedAt: at(1) },
        { createdAt: at(3), passed: false, startedAt: at(1) },
        { createdAt: at(12), passed: false, startedAt: at(1) },
      ],
      hints: [],
    });

    expect(e).toEqual({
      attempted: true,
      passed: true,
      attemptsToPass: 2,
      highestHintBeforePass: null,
      minutesToPass: 8,
      expectedMinutes: 10,
    });
  });

  it("counts only the hints asked before the first pass", () => {
    const e = exerciseEvidence({
      expectedMinutes: 10,
      attempts: [{ createdAt: at(5), passed: true, startedAt: at(0) }],
      hints: [
        { level: 2, createdAt: at(4) },
        { level: 5, createdAt: at(8) },
      ],
    });

    // The code was shown after they had already passed: that is curiosity, not rescue.
    expect(e.highestHintBeforePass).toBe(2);
  });

  it("counts every hint when it never passed", () => {
    const e = exerciseEvidence({
      expectedMinutes: null,
      attempts: [{ createdAt: at(5), passed: false, startedAt: null }],
      hints: [
        { level: 1, createdAt: at(1) },
        { level: 3, createdAt: at(9) },
      ],
    });

    expect(e).toMatchObject({
      passed: false,
      attemptsToPass: null,
      highestHintBeforePass: 3,
      minutesToPass: null,
    });
  });

  it("does not know the time to pass when no attempt said when it started", () => {
    const e = exerciseEvidence({
      expectedMinutes: 10,
      attempts: [{ createdAt: at(5), passed: true, startedAt: null }],
      hints: [],
    });

    expect(e.minutesToPass).toBeNull();
  });

  it("is untried with no attempts", () => {
    expect(exerciseEvidence({ expectedMinutes: 10, attempts: [], hints: [] })).toMatchObject({
      attempted: false,
      passed: false,
    });
  });
});

describe("lessonStrain", () => {
  it("does not judge a lesson that is not finished", () => {
    // Three failing runs in, the learner is working — not failing.
    expect(lessonStrain(null, [evidence({ passed: false, attemptsToPass: null })])).toEqual({
      verdict: null,
      unknown: "in-progress",
    });
  });

  it("calls it too hard when marked lost, whatever the exercise says", () => {
    expect(lessonStrain("lost", [evidence()])).toEqual({
      verdict: "too-hard",
      reasons: ["marked-lost"],
    });
    expect(lessonStrain("lost", [])).toEqual({ verdict: "too-hard", reasons: ["marked-lost"] });
  });

  it("calls it too hard when an exercise was tried and never passed", () => {
    const strain = lessonStrain("shaky", [evidence({ passed: false, attemptsToPass: null })]);

    expect(strain).toEqual({ verdict: "too-hard", reasons: ["never-passed"] });
  });

  it("calls it too hard when the pass came after being shown the shape or the code", () => {
    expect(lessonStrain("understood", [evidence({ highestHintBeforePass: 4 })])).toEqual({
      verdict: "too-hard",
      reasons: ["heavy-hints"],
    });
    // A concept (rung 3) is help, not rescue.
    expect(lessonStrain("understood", [evidence({ highestHintBeforePass: 3 })]).verdict).toBe(
      "in-zone",
    );
  });

  it("lists every reason that applies", () => {
    const strain = lessonStrain("lost", [
      evidence({ passed: false, attemptsToPass: null }),
      evidence({ highestHintBeforePass: 5 }),
    ]);

    expect(strain).toEqual({
      verdict: "too-hard",
      reasons: ["marked-lost", "never-passed", "heavy-hints"],
    });
  });

  it("has nothing to judge with no exercise and no lost", () => {
    expect(lessonStrain("understood", [])).toEqual({ verdict: null, unknown: "no-exercise" });
  });

  it("has nothing to judge when the exercises were never tried", () => {
    expect(lessonStrain("understood", [evidence({ attempted: false, passed: false })])).toEqual({
      verdict: null,
      unknown: "not-attempted",
    });
  });

  it("calls it too easy only on a fast first try with no help", () => {
    expect(
      lessonStrain("understood", [evidence({ minutesToPass: 5, expectedMinutes: 10 })]),
    ).toEqual({ verdict: "too-easy", reasons: ["first-try-no-hints-fast"] });
  });

  it.each<[string, Partial<ExerciseEvidence>]>([
    ["took two attempts", { attemptsToPass: 2 }],
    ["asked for a hint", { highestHintBeforePass: 1 }],
    ["took more than half the time", { minutesToPass: 6 }],
    ["has no clock behind it", { minutesToPass: null }],
    ["has no expected time", { expectedMinutes: null }],
  ])("is in the zone, not too easy, when the pass %s", (_label, over) => {
    expect(lessonStrain("understood", [evidence(over)]).verdict).toBe("in-zone");
  });

  it("is not too easy when marked shaky, or when an exercise was skipped", () => {
    expect(lessonStrain("shaky", [evidence()]).verdict).toBe("in-zone");
    expect(
      lessonStrain("understood", [evidence(), evidence({ attempted: false, passed: false })])
        .verdict,
    ).toBe("in-zone");
  });
});

describe("nextAdjustment", () => {
  const lesson = (slug: string, strain: Strain, bridged = false): JudgedLesson => ({
    lessonId: `id-${slug}`,
    slug,
    title: slug,
    strain,
    bridged,
  });
  const hard: Strain = { verdict: "too-hard", reasons: ["never-passed"] };
  const easy: Strain = { verdict: "too-easy", reasons: ["first-try-no-hints-fast"] };
  const zone: Strain = { verdict: "in-zone", reasons: ["passed"] };
  const open: Strain = { verdict: null, unknown: "in-progress" };

  it("has no signal with nothing judged, which is not 'as planned'", () => {
    expect(nextAdjustment([])).toBeNull();
    expect(nextAdjustment([lesson("a", open)])).toBeNull();
  });

  it("bridges toward the newest judged lesson when it was too hard", () => {
    expect(nextAdjustment([lesson("open", open), lesson("hard", hard)])).toEqual({
      kind: "bridge",
      lesson: lesson("hard", hard),
    });
  });

  it("builds one bridge per lesson, not one per press", () => {
    expect(nextAdjustment([lesson("hard", hard, true)])).toEqual({ kind: "as-planned" });
  });

  it("pushes harder only after two too-easy lessons in a row", () => {
    expect(nextAdjustment([lesson("b", easy), lesson("a", easy)])).toEqual({
      kind: "harder",
      because: [lesson("b", easy), lesson("a", easy)],
    });
    expect(nextAdjustment([lesson("b", easy)])).toEqual({ kind: "as-planned" });
    expect(nextAdjustment([lesson("b", easy), lesson("a", zone)])).toEqual({ kind: "as-planned" });
  });

  it("goes as planned after a lesson in the zone", () => {
    expect(nextAdjustment([lesson("a", zone), lesson("z", hard)])).toEqual({ kind: "as-planned" });
  });
});

describe("resolveBridges", () => {
  const lesson = (
    id: string,
    slug: string,
    seq: number | null,
    adjustment: AdaptableLesson["adjustment"] = null,
  ): AdaptableLesson => ({ id, slug, seq, adjustment });

  it("links a bridge to the lesson it names, both ways", () => {
    const bridges = resolveBridges([
      lesson("a", "commit-index", 1),
      lesson("b", "smaller-step", 2, { kind: "bridge", bridgeForSlug: "commit-index" }),
    ]);

    expect(bridges.target.get("b")).toBe("a");
    expect(bridges.bridgeOf.get("a")).toBe("b");
  });

  it("picks the earliest lesson when written lessons share a slug", () => {
    const bridges = resolveBridges([
      lesson("later", "retries", 5),
      lesson("first", "retries", 2),
      lesson("bridge", "step", 6, { kind: "bridge", bridgeForSlug: "retries" }),
    ]);

    expect(bridges.target.get("bridge")).toBe("first");
  });

  it("keeps the first bridge toward a lesson when there are two", () => {
    const bridges = resolveBridges([
      lesson("a", "x", 1),
      lesson("second", "s2", 4, { kind: "bridge", bridgeForSlug: "x" }),
      lesson("first", "s1", 3, { kind: "bridge", bridgeForSlug: "x" }),
    ]);

    expect(bridges.bridgeOf.get("a")).toBe("first");
  });

  it("links nothing for a slug that names no lesson, a missing slug, or itself", () => {
    const bridges = resolveBridges([
      lesson("a", "x", 1, { kind: "bridge", bridgeForSlug: "nowhere" }),
      lesson("b", "y", 2, { kind: "bridge", bridgeForSlug: null }),
      lesson("c", "z", null, { kind: "bridge", bridgeForSlug: "z" }),
      lesson("d", "w", 3, { kind: "harder", bridgeForSlug: null }),
    ]);

    expect(bridges.target.size).toBe(0);
    expect(bridges.bridgeOf.size).toBe(0);
  });
});
