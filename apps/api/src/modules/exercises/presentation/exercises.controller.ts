import {
  ExerciseKeySchema,
  RecordAttemptSchema,
  ReportTaskSchema,
  RequestHintSchema,
  RequestReviewSchema,
  UuidSchema,
  type ExerciseView,
  type LessonExercisesView,
  type RecordAttemptInput,
  type ReportTaskInput,
  type RequestHintInput,
  type RequestReviewInput,
} from "@mindforge/core";
import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";

import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import {
  ListLessonExercises,
  RecordExerciseAttempt,
  ReportTaskResult,
  RequestExerciseHint,
  RequestExerciseReview,
  RevealSolution,
} from "../application/exercises.use-cases.js";
import { toExerciseView, toLessonExercisesView } from "./exercise.view.js";

/**
 * `/v1/lessons/:lessonId/exercises` — the exercise panel's endpoints (FR-X2, FR-X5).
 *
 * Under the lesson rather than at the top level, unlike the lesson itself: an
 * exercise has no identity outside the lesson that declares it, and its key is
 * only unique there.
 *
 * **An attempt is a `POST`, and not idempotent on purpose.** Running the same code
 * twice is two attempts — "how many tries did it take" counts runs, and a retry
 * that deduplicated would be a smaller number than the truth.
 */
@Controller("lessons/:lessonId/exercises")
export class ExercisesController {
  constructor(
    private readonly list: ListLessonExercises,
    private readonly record: RecordExerciseAttempt,
    private readonly hint: RequestExerciseHint,
    private readonly review: RequestExerciseReview,
    private readonly report: ReportTaskResult,
    private readonly solution: RevealSolution,
  ) {}

  @Get()
  async exercises(
    @CurrentUser() user: RequestContext,
    @Param("lessonId", zodPipe(UuidSchema)) lessonId: string,
  ): Promise<LessonExercisesView> {
    return toLessonExercisesView(await this.list.execute(user.userId, lessonId));
  }

  @Post(":key/attempts")
  @HttpCode(201)
  async attempt(
    @CurrentUser() user: RequestContext,
    @Param("lessonId", zodPipe(UuidSchema)) lessonId: string,
    @Param("key", zodPipe(ExerciseKeySchema)) key: string,
    @Body(zodPipe(RecordAttemptSchema)) body: RecordAttemptInput,
  ): Promise<ExerciseView> {
    return toExerciseView(await this.record.execute(user.userId, lessonId, key, body));
  }

  /**
   * One rung of help (FR-H1). A `POST` that is not idempotent, like an attempt:
   * asking twice is two hints, billed twice, and both are what happened.
   */
  @Post(":key/hints")
  @HttpCode(201)
  async requestHint(
    @CurrentUser() user: RequestContext,
    @Param("lessonId", zodPipe(UuidSchema)) lessonId: string,
    @Param("key", zodPipe(ExerciseKeySchema)) key: string,
    @Body(zodPipe(RequestHintSchema)) body: RequestHintInput,
  ): Promise<ExerciseView> {
    return toExerciseView(await this.hint.execute(user, lessonId, key, body));
  }

  /**
   * A drawn design, reviewed against its rubric (FR-X8). Not idempotent, like an
   * attempt: two submissions are two reviews, billed twice, and both happened.
   *
   * The body carries a PNG of the canvas, which is why the API's body limit is
   * raised in `bootstrap.ts`; `RequestReviewSchema` caps each field.
   */
  @Post(":key/reviews")
  @HttpCode(201)
  async requestReview(
    @CurrentUser() user: RequestContext,
    @Param("lessonId", zodPipe(UuidSchema)) lessonId: string,
    @Param("key", zodPipe(ExerciseKeySchema)) key: string,
    @Body(zodPipe(RequestReviewSchema)) body: RequestReviewInput,
  ): Promise<ExerciseView> {
    return toExerciseView(await this.review.execute(user, lessonId, key, body));
  }

  /** A `task` exercise's self-reported result: the learner ran it on their machine. */
  @Post(":key/reports")
  @HttpCode(201)
  async reportTask(
    @CurrentUser() user: RequestContext,
    @Param("lessonId", zodPipe(UuidSchema)) lessonId: string,
    @Param("key", zodPipe(ExerciseKeySchema)) key: string,
    @Body(zodPipe(ReportTaskSchema)) body: ReportTaskInput,
  ): Promise<ExerciseView> {
    return toExerciseView(await this.report.execute(user.userId, lessonId, key, body));
  }

  /**
   * Opening the reference solution — recorded as help (review finding #4). Written
   * once per exercise however often it is opened.
   */
  @Post(":key/solution-reveals")
  @HttpCode(201)
  async revealSolution(
    @CurrentUser() user: RequestContext,
    @Param("lessonId", zodPipe(UuidSchema)) lessonId: string,
    @Param("key", zodPipe(ExerciseKeySchema)) key: string,
  ): Promise<ExerciseView> {
    return toExerciseView(await this.solution.execute(user.userId, lessonId, key));
  }
}
