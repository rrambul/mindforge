import {
  AttributeFrictionSchema,
  FrictionSummaryQuerySchema,
  LogFrictionSchema,
  UuidSchema,
  type AttributeFrictionInput,
  type FrictionChips,
  type FrictionSummaryQuery,
  type FrictionType,
  type LogFrictionInput,
} from "@mindforge/core";
import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import {
  AttributeFriction,
  GetFrictionChips,
  GetFrictionSummary,
  ListSessionFriction,
  LogFriction,
  type FrictionSummary,
} from "../application/friction.use-cases.js";
import type { FrictionEvent } from "../domain/friction-event.js";

export interface FrictionEventView {
  readonly id: string;
  /** A key. The UI translates it at render (§5.2). */
  readonly type: FrictionType;
  readonly intensity: number;
  readonly note: string | null;
  readonly occurredAt: string;
  readonly sessionId: string | null;
}

function toView(event: FrictionEvent): FrictionEventView {
  const e = event.toSnapshot();
  return {
    id: e.id,
    type: e.type,
    intensity: e.intensity,
    note: e.note,
    occurredAt: e.occurredAt.toISOString(),
    sessionId: e.sessionId,
  };
}

@Controller("friction")
export class FrictionController {
  constructor(
    private readonly logFriction: LogFriction,
    private readonly chips: GetFrictionChips,
    private readonly summary: GetFrictionSummary,
    private readonly attribute: AttributeFriction,
    private readonly forSession: ListSessionFriction,
  ) {}

  /** One tap. FR-C1, FR-C2. */
  @Post()
  async log(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(LogFrictionSchema)) body: LogFrictionInput,
  ): Promise<FrictionEventView> {
    return toView(await this.logFriction.execute(user.userId, body));
  }

  /**
   * Which four to show inline, and what goes behind "More" (§5.3).
   *
   * Ranked server-side because the window is 30 days of history the client does not hold, and
   * because the eventual command palette must offer the same order — a bar and a palette that
   * disagreed would be two different products.
   */
  @Get("chips")
  getChips(@CurrentUser() user: RequestContext): Promise<FrictionChips> {
    return this.chips.execute(user.userId);
  }

  /**
   * A session's own friction, for the debrief (§5.3).
   *
   * Under `/friction` rather than `/focus/sessions/:id/friction`: the events belong to this module, and
   * a route that read another module's rows would be two places to keep the shape in step.
   */
  @Get("sessions/:sessionId")
  async listForSession(
    @CurrentUser() user: RequestContext,
    @Param("sessionId", zodPipe(UuidSchema)) sessionId: string,
  ): Promise<{ events: FrictionEventView[] }> {
    const events = await this.forSession.execute(user.userId, sessionId);
    return { events: events.map(toView) };
  }

  /**
   * What the friction was about (§5.3).
   *
   * The one thing about an event that can be revised. The type and the moment are what you tapped;
   * changing those afterwards would make the friction record a story rather than a log.
   */
  @Patch(":id")
  async attributeEvent(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(AttributeFrictionSchema)) body: AttributeFrictionInput,
  ): Promise<FrictionEventView> {
    return toView(await this.attribute.execute(user.userId, id, body));
  }

  @Get("summary")
  getSummary(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(FrictionSummaryQuerySchema)) query: FrictionSummaryQuery,
  ): Promise<FrictionSummary> {
    return this.summary.execute(user.userId, query);
  }
}
