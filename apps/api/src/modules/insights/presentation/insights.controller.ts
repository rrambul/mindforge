import {
  ActivityGridQuerySchema,
  BacklogQuerySchema,
  FrictionSummaryQuerySchema,
  type ActivityGrid,
  type ActivityGridQuery,
  type BacklogQuery,
  type FrictionSummaryQuery,
} from "@mindforge/core";
import { Controller, Get, Query, UseInterceptors } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import {
  GetActivityGrid,
  GetBacklogHealth,
  GetFrictionAnalytics,
  type ActivityGridResult,
  type BacklogInsight,
  type FrictionAnalytics,
} from "../application/insights.use-cases.js";
import { ETagInterceptor } from "./etag.interceptor.js";

/**
 * The grid on the wire.
 *
 * `ActivityGrid` is already wire-shaped — every date in it is an `IsoDate`, which is a string on
 * purpose — so the mapper exists for one field: `rebuiltAt` is a real instant and serialises as
 * ISO 8601 UTC, with the user's timezone applied at render like every other timestamp.
 */
export interface ActivityGridView extends ActivityGrid {
  /**
   * When the nightly rollup last wrote a day in this range, or null when the range holds no rows.
   *
   * Null on an empty range rather than the job's last run overall: "you did nothing in March" and
   * "March has never been rolled up" are different answers, and without this the UI cannot tell a
   * quiet month from a broken job.
   */
  readonly rebuiltAt: string | null;
}

export function toActivityGridView(result: ActivityGridResult): ActivityGridView {
  return { ...result.grid, rebuiltAt: result.rebuiltAt?.toISOString() ?? null };
}

/**
 * `/v1/insights` (§6) — the read-only dashboard.
 *
 * Every route here is a `GET` over rollups that change once a night, which is why §6.1 singles this
 * module out for `ETag` + `If-None-Match`. The interceptor is applied to the controller rather than
 * per route, so a fourth insight cannot be added without it.
 *
 * The other three routes §6's table lists — `/focus`, `/learning`, `/consumption-vs-retention` —
 * are absent rather than stubbed. Retention and lessons have no source table until M4–M6, and an
 * endpoint that could only answer zero is the failure mode the grid's layer list already avoids.
 */
@UseInterceptors(ETagInterceptor)
@Controller("insights")
export class InsightsController {
  constructor(
    private readonly grid: GetActivityGrid,
    private readonly backlog: GetBacklogHealth,
    private readonly friction: GetFrictionAnalytics,
  ) {}

  /** FR-I6b, §3.9. */
  @Get("activity")
  async activity(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(ActivityGridQuerySchema)) query: ActivityGridQuery,
  ): Promise<ActivityGridView> {
    return toActivityGridView(await this.grid.execute(user.userId, query, user));
  }

  /** FR-I7, FR-R6. */
  @Get("backlog")
  backlogHealth(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(BacklogQuerySchema)) query: BacklogQuery,
  ): Promise<BacklogInsight> {
    return this.backlog.execute(user.userId, query, user);
  }

  /**
   * The friction lists the weekly review needs (§6, FR-I6b).
   *
   * Shares `FrictionSummaryQuerySchema` with `/friction/summary` deliberately: the two answer the
   * same window over the same rows, and a second window schema is a second thing to keep in step.
   * `missionId` narrows through the session join, so setting it empties `unattributed` by
   * construction — a standalone tap has no mission to match.
   */
  @Get("friction")
  frictionAnalytics(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(FrictionSummaryQuerySchema)) query: FrictionSummaryQuery,
  ): Promise<FrictionAnalytics> {
    return this.friction.execute(user.userId, query);
  }
}
