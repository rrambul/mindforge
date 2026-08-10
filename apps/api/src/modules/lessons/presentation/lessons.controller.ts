import { CompleteLessonSchema, UuidSchema, type CompleteLessonInput } from "@mindforge/core";
import { Body, Controller, Delete, Get, Header, Param, Put } from "@nestjs/common";

import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import {
  ClearLessonCompletion,
  CompleteLesson,
  GetLesson,
} from "../application/lessons.use-cases.js";
import { toLessonView, type LessonView } from "./lesson.view.js";

/**
 * `/v1/lessons/:id` — the reader's endpoint (FR-T5, FR-P1).
 *
 * At the top level rather than under the mission, unlike the curriculum: a lesson
 * has an identity of its own, it is what a learning record points at, and the
 * reader is reached by a link that should not have to carry two ids to work.
 *
 * **`GET` mints a grant, so it must not be cached.** The URL it returns stops
 * working after half an hour, and a cached response outliving it is a reader that
 * shows a blank frame with nothing to say about why. `no-store` rather than a
 * short `max-age`: the response is small, and the failure it prevents is silent.
 *
 * **Completion is a `PUT`, not a `POST`.** Marking the same lesson understood
 * twice is the same lesson understood once — §6.1's rule for capture paths, and
 * the thing that lets the SPA retry without asking whether the first attempt
 * landed.
 */
@Controller("lessons")
export class LessonsController {
  constructor(
    private readonly get: GetLesson,
    private readonly complete: CompleteLesson,
    private readonly clear: ClearLessonCompletion,
  ) {}

  @Get(":lessonId")
  @Header("Cache-Control", "no-store")
  async open(
    @CurrentUser() user: RequestContext,
    @Param("lessonId", zodPipe(UuidSchema)) lessonId: string,
  ): Promise<LessonView> {
    return toLessonView(await this.get.execute(user.userId, lessonId));
  }

  /** Understood, shaky or lost — two taps from the reader (FR-P1, §7.1). */
  @Put(":lessonId/completion")
  async finish(
    @CurrentUser() user: RequestContext,
    @Param("lessonId", zodPipe(UuidSchema)) lessonId: string,
    @Body(zodPipe(CompleteLessonSchema)) body: CompleteLessonInput,
  ): Promise<LessonView> {
    return toLessonView(await this.complete.execute(user.userId, lessonId, body.outcome));
  }

  /**
   * Undo a mis-tap. Not a way to make a bad week look better — the outcome you
   * record stays until you record another one (non-negotiable 10).
   */
  @Delete(":lessonId/completion")
  async reopen(
    @CurrentUser() user: RequestContext,
    @Param("lessonId", zodPipe(UuidSchema)) lessonId: string,
  ): Promise<LessonView> {
    return toLessonView(await this.clear.execute(user.userId, lessonId));
  }
}
