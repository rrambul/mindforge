import {
  ActivityGridQuerySchema,
  type ActivityGrid,
  type ActivityGridQuery,
} from "@mindforge/core";
import { Controller, Get, Query, UseInterceptors } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import { GetActivityGrid, type ActivityGridResult } from "../application/insights.use-cases.js";
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
 * `/v1/insights` (§6) — the frequency tracker's read side.
 *
 * A `GET` over a rollup that changes once a night, which is why §6.1 singles this module out for
 * `ETag` + `If-None-Match`. The interceptor is applied to the controller rather than per route, so
 * a second insight cannot be added without it.
 */
@UseInterceptors(ETagInterceptor)
@Controller("insights")
export class InsightsController {
  constructor(private readonly grid: GetActivityGrid) {}

  /** FR-Q1. */
  @Get("activity")
  async activity(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(ActivityGridQuerySchema)) query: ActivityGridQuery,
  ): Promise<ActivityGridView> {
    return toActivityGridView(await this.grid.execute(user.userId, query));
  }
}
