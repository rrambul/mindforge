import { describe, expect, it } from "vitest";

import type { ExerciseWithAttempts } from "../application/exercises.use-cases.js";
import { toExerciseView } from "./exercise.view.js";

/**
 * The one rule this file enforces rather than formats: a whiteboard's rubric and
 * reference design do not leave the server until the learner has had a review
 * (FR-X7). A checklist that travelled to the browser to be hidden there would be
 * one click in the network tab away.
 */

const UNTRIED = {
  count: 0,
  firstPassedAt: null,
  lastCode: null,
  lastPassed: null,
  lastAt: null,
  lastResults: null,
  lastScene: null,
};

const board = (count: number): ExerciseWithAttempts => ({
  exercise: {
    key: "charge-once",
    kind: "whiteboard",
    title: "Charge exactly once",
    prompt: "Draw it.",
    rubric: ["Sends an idempotency key", "Stores the key with the result"],
    solution: "A reference design.",
    expectedMinutes: 20,
  },
  attempts: { ...UNTRIED, count },
  hints: [],
  nextHintLevel: 1,
  lessonKind: "lesson",
});

describe("toExerciseView", () => {
  it("withholds a whiteboard's rubric and reference design until the first review", () => {
    expect(toExerciseView(board(0))).toMatchObject({ rubric: null, solution: null });
  });

  it("sends both once the learner has been reviewed", () => {
    expect(toExerciseView(board(1))).toMatchObject({
      rubric: ["Sends an idempotency key", "Stores the key with the result"],
      solution: "A reference design.",
    });
  });

  it("sends a code exercise's solution from the start — it is shown on request, not withheld", () => {
    const view = toExerciseView({
      exercise: {
        key: "commit-index",
        kind: "code",
        language: "typescript",
        title: "Commit index",
        prompt: "Write it.",
        starter: "",
        tests: 'test("x", () => {});',
        solution: "export const x = 1;",
        expectedMinutes: null,
      },
      attempts: UNTRIED,
      hints: [],
      nextHintLevel: 1,
      lessonKind: "lesson",
    });

    expect(view).toMatchObject({ kind: "code", solution: "export const x = 1;" });
  });
});

describe("toExerciseView on an exam (FR-E5)", () => {
  const PASSED = { ...UNTRIED, count: 2, firstPassedAt: new Date("2026-10-01T10:00:00Z") };
  const code = (attempts: typeof UNTRIED | typeof PASSED): ExerciseWithAttempts => ({
    exercise: {
      key: "lend-it",
      kind: "code",
      language: "javascript",
      title: "Lend it",
      prompt: "Write it.",
      starter: "",
      tests: 'test("x", () => {});',
      solution: "export const x = 1;",
      expectedMinutes: null,
    },
    attempts,
    hints: [],
    nextHintLevel: 1,
    lessonKind: "exam",
  });

  it("does not send an unpassed item's solution — the network tab is not a hint", () => {
    expect(toExerciseView(code(UNTRIED))).toMatchObject({ solution: null });
  });

  it("sends it once the item is passed", () => {
    expect(toExerciseView(code(PASSED))).toMatchObject({ solution: "export const x = 1;" });
  });

  it("withholds a whiteboard's rubric after a failed review, until the item is passed", () => {
    const failed = {
      ...board(1),
      lessonKind: "exam" as const,
      attempts: {
        ...UNTRIED,
        count: 1,
        lastResults: [
          {
            name: "Sends an idempotency key",
            passed: false,
            message: "No key on the request.",
            verdict: "missing" as const,
          },
          {
            name: "Stores the key with the result",
            passed: true,
            message: "Yes.",
            verdict: "covered" as const,
          },
        ],
      },
    };

    const view = toExerciseView(failed);

    expect(view).toMatchObject({ rubric: null, solution: null });
    // The review's own lines name the rubric and say what is missing, which is the
    // answer by another route: the verdicts stay, the words go.
    expect(view.attempts.lastResults).toEqual([
      { name: "#1", passed: false, message: null, verdict: "missing" },
      { name: "#2", passed: true, message: null, verdict: "covered" },
    ]);
  });

  it("sends the rubric and the review in full once the whiteboard item is passed", () => {
    const view = toExerciseView({ ...board(1), lessonKind: "exam", attempts: PASSED });
    expect(view).toMatchObject({
      rubric: ["Sends an idempotency key", "Stores the key with the result"],
    });
  });
});
