import { rungOf, type ExerciseView, type LessonExercisesView } from "@mindforge/core";

import type { ExerciseWithAttempts, LessonExercises } from "../application/exercises.use-cases.js";

/**
 * An exercise on the wire.
 *
 * **A whiteboard's rubric and reference design are withheld until its first
 * review** (FR-X7). Here, where every exercise response passes, rather than in the
 * screen: a checklist of what a good answer covers is the answer, and one that
 * travelled to the browser to be hidden there would be one click in the network
 * tab away. After a review the learner has drawn their own design and been told
 * item by item how it read, and the rubric is the thing they need next.
 */
export function toExerciseView({
  exercise,
  attempts,
  hints,
  nextHintLevel,
}: ExerciseWithAttempts): ExerciseView {
  const progress = {
    hints: hints.map((hint) => ({
      kind: hint.kind,
      level: hint.level,
      rung: rungOf(hint.level),
      question: hint.question,
      answer: hint.answer,
      createdAt: hint.createdAt.toISOString(),
    })),
    nextHintLevel,
    attempts: {
      count: attempts.count,
      firstPassedAt: attempts.firstPassedAt?.toISOString() ?? null,
      lastCode: attempts.lastCode,
      lastPassed: attempts.lastPassed,
      lastAt: attempts.lastAt?.toISOString() ?? null,
      lastResults: attempts.lastResults,
      lastScene: attempts.lastScene,
    },
  };

  // Code and tasks withhold nothing: their solutions are shown on request, and
  // there is no checklist whose sight is the answer.
  if (exercise.kind !== "whiteboard") return { ...exercise, ...progress };

  const reviewed = attempts.count > 0;
  return {
    ...exercise,
    ...progress,
    rubric: reviewed ? exercise.rubric : null,
    solution: reviewed ? exercise.solution : null,
  };
}

export function toLessonExercisesView(listed: LessonExercises): LessonExercisesView {
  return {
    lessonId: listed.lessonId,
    runnerUrl: listed.runnerUrl,
    pythonRunnerUrl: listed.pythonRunnerUrl,
    strain: listed.strain,
    exercises: listed.exercises.map(toExerciseView),
  };
}
