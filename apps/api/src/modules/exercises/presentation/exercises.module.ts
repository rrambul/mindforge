import { Module } from "@nestjs/common";

import { ENV, type Env } from "../../../shared/config/env.js";
import { LessonsModule } from "../../lessons/presentation/lessons.module.js";
import { TeachModule } from "../../teach/presentation/teach.module.js";
import { EXERCISES_CONFIG } from "../application/exercises.config.js";
import {
  ListLessonExercises,
  RecordExerciseAttempt,
  ReportTaskResult,
  RequestExerciseHint,
  RequestExerciseReview,
  RevealSolution,
} from "../application/exercises.use-cases.js";
import { EXERCISE_REPOSITORY } from "../domain/exercise.repository.js";
import { HINT_GENERATOR } from "../domain/hint-generator.port.js";
import { REVIEWER } from "../domain/reviewer.port.js";
import {
  AnthropicHintGenerator,
  HINT_API_KEY,
} from "../infrastructure/anthropic-hint.generator.js";
import { AnthropicReviewer } from "../infrastructure/anthropic-reviewer.js";
import { PrismaExerciseRepository } from "../infrastructure/prisma-exercise.repository.js";
import { ExercisesController } from "./exercises.controller.js";

/**
 * Exercises: what a lesson asks you to do, and every time you tried (FR-X1–X6).
 *
 * Separate from `LessonsModule`, which owns exactly two columns and says so. The
 * exercise definitions are the reindexer's (they come from the file), and the
 * attempts are this module's — neither is the reader's completion.
 * `LessonsModule` is imported for its repository, which is how "is this lesson
 * yours, and is it written" keeps one answer; `TeachModule` for `TeachSpend`, so a
 * hint is refused by the same daily ceiling a lesson run is (FR-T8).
 */
@Module({
  imports: [LessonsModule, TeachModule],
  controllers: [ExercisesController],
  providers: [
    ListLessonExercises,
    RecordExerciseAttempt,
    RequestExerciseHint,
    RequestExerciseReview,
    ReportTaskResult,
    RevealSolution,
    { provide: REVIEWER, useClass: AnthropicReviewer },
    { provide: EXERCISE_REPOSITORY, useClass: PrismaExerciseRepository },
    { provide: HINT_GENERATOR, useClass: AnthropicHintGenerator },
    {
      provide: HINT_API_KEY,
      inject: [ENV],
      useFactory: (env: Env) => env.ANTHROPIC_API_KEY ?? null,
    },
    {
      provide: EXERCISES_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        runnerUrl: new URL("/runner", env.LESSONS_ORIGIN).toString(),
        pythonRunnerUrl: new URL("/runner/python", env.LESSONS_ORIGIN).toString(),
      }),
    },
  ],
})
export class ExercisesModule {}
