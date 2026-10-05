import type { ExerciseView } from "@mindforge/core";

/** A code exercise: an editor, a runner, tests, hints. */
export type CodeExerciseView = Extract<ExerciseView, { kind: "code" }>;

/** A whiteboard exercise: a canvas and a review against a rubric withheld until the first one. */
export type WhiteboardExerciseView = Extract<ExerciseView, { kind: "whiteboard" }>;

/** A task: code the learner writes and runs on their own machine, then reports back. */
export type TaskExerciseView = Extract<ExerciseView, { kind: "task" }>;

/** A lab: practice in a real environment the learner owns, reported back (FR-X11). */
export type LabExerciseView = Extract<ExerciseView, { kind: "lab" }>;
