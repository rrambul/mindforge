import type {
  ActivityGrid,
  BacklogHealth,
  FrictionType,
  GridLayer,
  IsoDate,
} from "@mindforge/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";

/**
 * The read-only dashboard (FR-I3, FR-I6b, FR-I7).
 *
 * Every type here mirrors a view the API already publishes, and the grid and backlog shapes are
 * `packages/core`'s own — `ActivityGrid` and `BacklogHealth` are wire-shaped by design, so
 * re-declaring their fields would be a second definition of the domain maths the SPA and the API
 * are required to agree on (non-negotiable 3). Only the fields the *controller* adds are written
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

/** Abandonment, all-time, because `resources` records that you quit and never when. */
export interface AbandonmentGap {
  readonly total: number;
  readonly reasons: readonly { readonly reason: string; readonly count: number }[];
}

/** Mirrors `BacklogInsight`. */
export interface BacklogResponse extends BacklogHealth {
  readonly abandonment: AbandonmentGap;
}

export interface FrictionTypeCount {
  /** A key. The UI translates it at render (§5.2). */
  readonly type: FrictionType;
  readonly count: number;
  readonly meanIntensity: number;
}

export interface MissionFrictionCount {
  readonly missionId: string;
  readonly topic: string;
  readonly count: number;
}

export interface UnattributedFriction {
  readonly total: number;
  /** Logged outside any session — the standalone tap FR-C1 exists for. */
  readonly standalone: number;
  /** Logged in a session that was never attached to a mission. */
  readonly sessionWithoutMission: number;
}

/** Mirrors `FrictionAnalytics`. */
export interface FrictionResponse {
  readonly eventCount: number;
  readonly byType: readonly FrictionTypeCount[];
  readonly byMission: readonly MissionFrictionCount[];
  readonly unattributed: UnattributedFriction;
}

export const insightKeys = {
  all: ["insights"] as const,
  activity: (from: IsoDate, to: IsoDate, layer: GridLayer) =>
    ["insights", "activity", from, to, layer] as const,
  backlog: () => ["insights", "backlog"] as const,
  friction: (since: string) => ["insights", "friction", since] as const,
};

export interface GridRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly layer: GridLayer;
}

/**
 * Nothing on this screen is cached past its query.
 *
 * The temptation is a long `staleTime` — the grid reads a rollup that changes once a night, and §6.1
 * puts an ETag on the route for that reason. But the other two read raw rows, so a friction tap
 * logged a minute ago belongs in them immediately; and a dashboard that quietly shows you yesterday
 * is the failure mode this product is least able to afford. Refetching is one indexed query.
 */
export function useActivityGrid(range: GridRange): UseQueryResult<ActivityGridResponse> {
  return useQuery({
    queryKey: insightKeys.activity(range.from, range.to, range.layer),
    queryFn: ({ signal }) =>
      api.get<ActivityGridResponse>(
        `/insights/activity?from=${range.from}&to=${range.to}&layer=${range.layer}`,
        signal,
      ),
    staleTime: 0,
  });
}

/**
 * Backlog health over the API's own default window.
 *
 * `windowDays` is deliberately not sent. The default is `BACKLOG_WINDOW_DAYS`, which is the same 28
 * the grid's companion figure counts over, and a control that let the two drift apart would put two
 * spans in one sentence on one screen. The response states the window it used.
 */
export function useBacklogHealth(): UseQueryResult<BacklogResponse> {
  return useQuery({
    queryKey: insightKeys.backlog(),
    queryFn: ({ signal }) => api.get<BacklogResponse>("/insights/backlog", signal),
    staleTime: 0,
  });
}

/** `since` is an instant, because friction events are timestamps rather than days. */
export function useFrictionAnalytics(since: string): UseQueryResult<FrictionResponse> {
  return useQuery({
    queryKey: insightKeys.friction(since),
    queryFn: ({ signal }) =>
      api.get<FrictionResponse>(`/insights/friction?since=${encodeURIComponent(since)}`, signal),
    staleTime: 0,
  });
}
