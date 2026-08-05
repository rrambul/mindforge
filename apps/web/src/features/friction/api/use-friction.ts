import type { FrictionType, LogFrictionInput } from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";
import type { ApiError } from "../../../shared/api/problem.js";
import { now } from "../../../shared/lib/clock.js";

export interface FrictionEvent {
  readonly id: string;
  readonly type: FrictionType;
  readonly intensity: number;
  readonly note: string | null;
  readonly occurredAt: string;
  readonly sessionId: string | null;
}

export interface ChipsResponse {
  readonly inline: readonly FrictionType[];
  readonly overflow: readonly FrictionType[];
}

export const frictionKeys = {
  all: ["friction"] as const,
  chips: ["friction", "chips"] as const,
  summary: ["friction", "summary"] as const,
};

/**
 * The ranked four (§5.3).
 *
 * Long `staleTime`: the ranking reads a 30-day window, so it does not meaningfully change
 * within a session — and the chips must not reorder under your thumb mid-session, because
 * muscle memory is the entire point of a one-tap control.
 */
export function useFrictionChips(enabled: boolean): UseQueryResult<ChipsResponse> {
  return useQuery({
    queryKey: frictionKeys.chips,
    queryFn: ({ signal }) => api.get<ChipsResponse>("/friction/chips", signal),
    enabled,
    staleTime: Infinity,
  });
}

export interface SummaryResponse {
  readonly productiveMinutes: number;
  readonly wastefulMinutes: number;
  readonly emberShare: number | null;
  readonly eventCount: number;
  readonly byType: Readonly<Partial<Record<string, number>>>;
}

export function useFrictionSummary(enabled: boolean): UseQueryResult<SummaryResponse> {
  return useQuery({
    queryKey: frictionKeys.summary,
    queryFn: ({ signal }) => api.get<SummaryResponse>("/friction/summary", signal),
    enabled,
  });
}

/**
 * The most latency-sensitive write in the product: mid-session, one-handed, usually while
 * annoyed. Optimistic and fire-and-forget by design.
 *
 * Two things make that safe rather than sloppy. The client mints the id, so a retry is a replay
 * rather than a duplicate (§6.1). And `occurredAt` is stamped here rather than server-side, so a
 * tap logged offline records when the friction happened instead of when it finally uploaded —
 * an afternoon on the subway would otherwise arrive as a burst at reconnect.
 *
 * Nothing is rolled back on failure. Unlike the timer there is no state to un-show — the tap
 * has already been acknowledged, and the honest recovery is the offline queue replaying it, not
 * an error asking the user to tap an annoyance again.
 */
export function useLogFriction(): UseMutationResult<
  FrictionEvent,
  ApiError,
  { type: FrictionType; sessionId: string | null }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ type, sessionId }) => {
      const body: LogFrictionInput = {
        id: crypto.randomUUID(),
        type,
        // Sent explicitly rather than defaulted server-side, so the timestamp survives a queue.
        occurredAt: now(),
        // Intensity is never asked inline (§5.3) — the server defaults it to 3.
        intensity: 3,
        ...(sessionId === null ? {} : { sessionId }),
      };
      return api.post<FrictionEvent>("/friction", body);
    },
    // Only the summary and the ranking change, and neither is on screen at the moment of the
    // tap. Invalidating on settle keeps the tap itself free of any refetch.
    onSettled: () => queryClient.invalidateQueries({ queryKey: frictionKeys.all }),
  });
}
