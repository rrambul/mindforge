import type { FrictionSplit, FrictionType } from "@mindforge/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";

/**
 * The two friction reads the weekly review needs.
 *
 * **Why they live in `planning` and not in `friction` or `insights`.** §2.2 rule 6: a feature never
 * imports a sibling, and the review screen is a planning screen. `features/friction` already has a
 * `useFrictionSummary`, but it takes no window — it answers "all time", which on a screen headed
 * with one week's dates would be a figure that looks like the week's and is not. So this is a second
 * *request*, not a second *implementation*: both endpoints compute their maths server-side from
 * `packages/core` (`emberShare`, the friction taxonomy's own ordering), and nothing here recomputes
 * either. Non-negotiable 3 is about the arithmetic, and the arithmetic stays where it is.
 *
 * The keys are deliberately nested under the existing `friction` namespace so that logging a friction
 * event — which invalidates `["friction"]` — refreshes these too.
 */

/** Mirrors the API's `FrictionTypeCount`. `type` is a key; the UI translates it (§5.2). */
export interface FrictionTypeCount {
  readonly type: FrictionType;
  readonly count: number;
  /** Mean intensity over this type's events, 1–5, to one decimal. */
  readonly meanIntensity: number;
}

/** Mirrors the API's `MissionFrictionCount`. */
export interface MissionFrictionCount {
  readonly missionId: string;
  readonly topic: string;
  readonly count: number;
}

/**
 * Friction with no mission behind it, split by *why* it has none — the distinction is the actionable
 * one, and collapsing the two would lose it.
 */
export interface UnattributedFriction {
  readonly total: number;
  /** Logged outside any session. */
  readonly standalone: number;
  /** Logged in a session that was never attached to a mission. */
  readonly sessionWithoutMission: number;
}

/** Mirrors the API's `FrictionAnalytics` (`GET /insights/friction`). */
export interface FrictionSourcesView {
  readonly eventCount: number;
  readonly byType: readonly FrictionTypeCount[];
  readonly byMission: readonly MissionFrictionCount[];
  readonly unattributed: UnattributedFriction;
}

/**
 * Mirrors the API's `FrictionSummary` (`GET /friction/summary`).
 *
 * Extends core's `FrictionSplit` rather than restating its three fields — that copy had already
 * drifted once, keeping the pre-M2 names months after the rule was renamed to ember and slag.
 */
export interface FrictionSplitView extends FrictionSplit {
  readonly eventCount: number;
  /** Taps logged outside a session, or inside one still running — counted, but given no minutes. */
  readonly unattributedEventCount: number;
  readonly byType: Readonly<Partial<Record<string, number>>>;
}

export const weekFrictionKeys = {
  split: (since: string, until: string) => ["friction", "summary", since, until] as const,
  sources: (since: string, until: string) => ["insights", "friction", since, until] as const,
};

/**
 * Both bounds are **instants**, not dates: `FrictionSummaryQuerySchema` coerces a `Date`, and the
 * moment a week begins depends on the profile's timezone. The caller derives them with `dayBounds`
 * from `packages/core`, which is the same function the API bounds the week with.
 *
 * `until` is exclusive and was added after the review screen shipped without it. Until then the
 * query was open-ended, so reviewing the week of the 2nd counted every event since the 2nd — and
 * the screen carried a caption admitting it. Being honest about a wrong number is worse than being
 * right when the fix is one bound.
 */
function window(since: string, until: string): string {
  return `since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`;
}

export function useFrictionSplitIn(
  since: string,
  until: string,
): UseQueryResult<FrictionSplitView> {
  return useQuery({
    queryKey: weekFrictionKeys.split(since, until),
    queryFn: ({ signal }) =>
      api.get<FrictionSplitView>(`/friction/summary?${window(since, until)}`, signal),
  });
}

/** FR-I6b — where the friction was, which `/friction/summary` cannot answer. */
export function useFrictionSourcesIn(
  since: string,
  until: string,
): UseQueryResult<FrictionSourcesView> {
  return useQuery({
    queryKey: weekFrictionKeys.sources(since, until),
    queryFn: ({ signal }) =>
      api.get<FrictionSourcesView>(`/insights/friction?${window(since, until)}`, signal),
  });
}
