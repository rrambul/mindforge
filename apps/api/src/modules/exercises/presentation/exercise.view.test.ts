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
    });

    expect(view).toMatchObject({ kind: "code", solution: "export const x = 1;" });
  });
});
