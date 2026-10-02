import { SetDeadlineSchema, type SetDeadlineInput } from "@mindforge/core";
import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from "@nestjs/common";

import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import { GetCurriculum, type CurriculumView } from "../application/get-curriculum.js";
import { SetDeadline } from "../application/set-deadline.js";

/**
 * `/v1/missions/:missionId/curriculum` (FR-K5).
 *
 * Under the mission rather than at the top level, because a curriculum has no
 * identity of its own: it is the mission's structure, and there is exactly one.
 *
 * The view is already wire-shaped — every derived field is a boolean, a count or a
 * fraction — so there is no mapper here. The one thing it deliberately does not
 * carry is a percentage: `progress` is `{ completed, total }` or null, and the
 * decision of how to render "no plan yet" belongs to the screen rather than to a
 * number that has to pretend.
 */
@Controller("missions")
export class CurriculumController {
  constructor(
    private readonly curriculum: GetCurriculum,
    private readonly deadlines: SetDeadline,
  ) {}

  @Get(":missionId/curriculum")
  get(
    @CurrentUser() user: RequestContext,
    @Param("missionId", ParseUUIDPipe) missionId: string,
  ): Promise<CurriculumView> {
    return this.curriculum.execute(user.userId, missionId, user.timezone);
  }

  /**
   * Commit to a date for a module, or move it (FR-U2). `PUT` because the request
   * says what the deadline should be; the history behind it is the server's, and
   * every change to it is a new row rather than an overwrite.
   *
   * Answers with the whole curriculum, which is what the screen renders from.
   */
  @Put(":missionId/modules/:moduleId/deadline")
  setDeadline(
    @CurrentUser() user: RequestContext,
    @Param("missionId", ParseUUIDPipe) missionId: string,
    @Param("moduleId", ParseUUIDPipe) moduleId: string,
    @Body(zodPipe(SetDeadlineSchema)) body: SetDeadlineInput,
  ): Promise<CurriculumView> {
    return this.deadlines.execute(user.userId, missionId, moduleId, user.timezone, body);
  }
}
