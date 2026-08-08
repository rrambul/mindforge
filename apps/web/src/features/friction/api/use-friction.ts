import type { FrictionSplit, FrictionType, LogFrictionInput } from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";
import { NetworkError, type RequestError } from "../../../shared/api/problem.js";
import { now } from "../../../shared/lib/clock.js";
import { useOfflineQueue } from "../../../shared/lib/queue-context.js";

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

/**
 * Extends the core type rather than restating it.
 *
 * The three split fields were hand-copied here and had already drifted: they still read
 * `productiveMinutes`/`wastefulMinutes` after the M2 rule renamed them to ember and slag, and
 * nothing caught it because a hand-written response interface is a claim about the server, not a
 * check on one. Anchoring to `FrictionSplit` makes the next rename a type error here.
 */
export interface SummaryResponse extends FrictionSplit {
  readonly eventCount: number;
  /** Taps logged outside a session, or inside one still running — counted, but given no minutes. */
  readonly unattributedEventCount: number;
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
/**
 * Builds the body a tap sends.
 *
 * Separate from the hook so the mutation's *variables* are the exact body — which is what lets
 * `onError` queue precisely what failed. Deriving it again on retry would mint a new id and throw
 * away the idempotency the whole queue depends on.
 */
export function frictionBody(type: FrictionType, sessionId: string | null): LogFrictionInput {
  return {
    // Client-minted, so a replay is the same event rather than a second one (§6.1).
    id: crypto.randomUUID(),
    type,
    // Stamped here rather than server-side, so a tap logged offline records when the friction
    // happened instead of when it uploaded — an afternoon on the subway would otherwise arrive as
    // a burst at reconnect.
    occurredAt: now(),
    // Intensity is never asked inline (§5.3); 3 is the documented default.
    intensity: 3,
    ...(sessionId === null ? {} : { sessionId }),
  };
}

export function useLogFriction(): UseMutationResult<FrictionEvent, RequestError, LogFrictionInput> {
  const queryClient = useQueryClient();
  const offline = useOfflineQueue();

  return useMutation({
    mutationFn: (body) => api.post<FrictionEvent>("/friction", body),
    onError: (error, body) => {
      // This is the case the whole queue exists for: §5 calls the subway the realistic one, and
      // losing a friction tap does not merely lose a row — it kills trust in the number, which is
      // worse than having no number, because you would still act on it.
      if (error instanceof NetworkError && offline && body.id) {
        void offline.queue.enqueue(`friction:${body.id}`, "/friction", body);
      }
    },
    /**
     * The summary, but **not** the chip ranking.
     *
     * This invalidated `frictionKeys.all`, which prefix-matches `["friction","chips"]` — and
     * `invalidateQueries` refetches active queries regardless of `staleTime`, so the `Infinity`
     * above did not protect it. With two types tied in the 30-day window, tapping one reordered the
     * four inline chips under the user's thumb about 200ms later, and a rapid second tap logged the
     * wrong type. The comment on `useFrictionChips` says that must not happen; this is what was
     * making it happen.
     *
     * The ranking is a 30-day window and genuinely does not change meaningfully within a session, so
     * leaving it until the next mount is not a staleness problem — it is the behaviour that comment
     * describes.
     */
    onSettled: () => queryClient.invalidateQueries({ queryKey: frictionKeys.summary }),
  });
}

/** Mirrors the API's FrictionEventView. */
export interface FrictionEventRow {
  readonly id: string;
  readonly type: FrictionType;
  readonly intensity: number;
  readonly occurredAt: string;
  readonly skillId: string | null;
  readonly resourceId: string | null;
}

export const sessionFrictionKey = (sessionId: string) =>
  ["friction", "session", sessionId] as const;

/** A session's own friction, for the debrief (§5.3). */
export function useSessionFriction(
  sessionId: string | null,
): UseQueryResult<{ events: FrictionEventRow[] }> {
  return useQuery({
    queryKey: sessionFrictionKey(sessionId ?? ""),
    queryFn: ({ signal }) =>
      api.get<{ events: FrictionEventRow[] }>(`/friction/sessions/${sessionId!}`, signal),
    enabled: sessionId !== null,
  });
}

/**
 * What the friction was about (§5.3).
 *
 * Not queued offline, unlike the tap that created the event. Attribution is a considered answer given
 * in the debrief, so a failure has to be visible — and a replay could land after the skill it names had
 * been deleted, which is exactly when the server's existence check needs to run against what is stored.
 */
export function useAttributeFriction(): UseMutationResult<
  FrictionEventRow,
  RequestError,
  { id: string; attribution: { skillId?: string | null; resourceId?: string | null } }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, attribution }) =>
      api.patch<FrictionEventRow>(`/friction/${id}`, attribution),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["friction"] }),
  });
}
