import type { ActivityGrid, IsoDate } from "@mindforge/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";

/**
 * The frequency tracker's read side (FR-Q1).
 *
 * The grid shape is `packages/core`'s own — `ActivityGrid` is wire-shaped by design, so
 * re-declaring its fields would be a second definition of the domain maths the SPA and the API
 * are required to agree on (non-negotiable 3). Only the field the *controller* adds is written
 * out below.
 */

/** Mirrors `ActivityGridView`. */
export interface ActivityGridResponse extends ActivityGrid {
  /**
   * When the nightly rollup last wrote a day in this range, or null when the range holds no rows.
   *
   * Rendered rather than ignored: a stale grid and an empty grid look identical without it, and a
   * nightly job is the thing most likely to fail quietly.
   */
  readonly rebuiltAt: string | null;
}

export const insightKeys = {
  all: ["insights"] as const,
  activity: (from: IsoDate, to: IsoDate) => ["insights", "activity", from, to] as const,
};

export interface GridRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

/**
 * Not cached past its query.
 *
 * The temptation is a long `staleTime` — the grid reads a rollup that changes once a night, and §6.1
 * puts an ETag on the route for that reason. But a dashboard that quietly shows you yesterday is the
 * failure mode this product is least able to afford, and refetching is one indexed query.
 */
export function useActivityGrid(range: GridRange): UseQueryResult<ActivityGridResponse> {
  return useQuery({
    queryKey: insightKeys.activity(range.from, range.to),
    queryFn: ({ signal }) =>
      api.get<ActivityGridResponse>(`/insights/activity?from=${range.from}&to=${range.to}`, signal),
    staleTime: 0,
  });
}
