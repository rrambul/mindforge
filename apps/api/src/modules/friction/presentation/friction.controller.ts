import {
  FrictionSummaryQuerySchema,
  LogFrictionSchema,
  type FrictionChips,
  type FrictionSummaryQuery,
  type FrictionType,
  type LogFrictionInput,
} from "@mindforge/core";
import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import {
  GetFrictionChips,
  GetFrictionSummary,
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

  @Get("summary")
  getSummary(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(FrictionSummaryQuerySchema)) query: FrictionSummaryQuery,
  ): Promise<FrictionSummary> {
    return this.summary.execute(user.userId, query);
  }
}
