import type {
  DebriefFocusSessionInput,
  EntryMode,
  IntentionOutcome,
  StartFocusSessionInput,
} from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";
import type { ApiError } from "../../../shared/api/problem.js";
import { nowIso } from "../../../shared/lib/clock.js";

/** Mirrors the API's FocusSessionView. */
export interface FocusSession {
  readonly id: string;
  readonly intention: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly plannedMinutes: number | null;
  readonly minutes: number | null;
  readonly isRunning: boolean;
  readonly entryMode: EntryMode;
  readonly hitIntention: IntentionOutcome | null;
  readonly focusQuality: number | null;
  readonly energy: number | null;
  readonly note: string | null;
  readonly missionId: string | null;
}

interface RunningResponse {
  readonly session: FocusSession | null;
}

export const focusKeys = {
  all: ["focus"] as const,
  running: ["focus", "running"] as const,
  sessions: ["focus", "sessions"] as const,
};

/**
 * The Today screen's first question.
 *
 * `refetchOnMount` and a short `staleTime`, because the answer changes on another device:
 * §5 wants a timer started on your laptop visible from your phone. SSE (§5) replaces this
 * poll-on-focus behaviour later; until then a refetch when the tab wakes is the cheap
 * approximation.
 */
export function useRunningSession(enabled: boolean): UseQueryResult<RunningResponse> {
  return useQuery({
    queryKey: focusKeys.running,
    queryFn: ({ signal }) => api.get<RunningResponse>("/focus/sessions/running", signal),
    enabled,
    staleTime: 5_000,
  });
}

export function useRecentSessions(enabled: boolean): UseQueryResult<{ sessions: FocusSession[] }> {
  return useQuery({
    queryKey: focusKeys.sessions,
    queryFn: ({ signal }) => api.get<{ sessions: FocusSession[] }>("/focus/sessions", signal),
    enabled,
  });
}

/**
 * Starting is optimistic, and this is the one place §5 is emphatic about it: "a capture that
 * waits on a round-trip has already failed" the ≤5s budget. The timer appears on the tap and
 * reconciles when the response lands.
 *
 * The client mints the id (§6.1) so the optimistic row and the persisted one are the same row,
 * and so a retry is a replay rather than a second session.
 */
export function useStartSession(): UseMutationResult<
  FocusSession,
  ApiError,
  StartFocusSessionInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => api.post<FocusSession>("/focus/sessions/start", input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: focusKeys.running });
      const previous = queryClient.getQueryData<RunningResponse>(focusKeys.running);

      queryClient.setQueryData<RunningResponse>(focusKeys.running, {
        session: {
          id: input.id ?? "optimistic",
          intention: input.intention ?? null,
          // The elapsed ticker reads this, so it must be a real instant rather than a
          // placeholder — otherwise the timer starts at a nonsense number for one round trip.
          startedAt: nowIso(),
          endedAt: null,
          plannedMinutes: input.plannedMinutes ?? null,
          minutes: null,
          isRunning: true,
          entryMode: "timer",
          hitIntention: null,
          focusQuality: null,
          energy: null,
          note: null,
          missionId: input.missionId ?? null,
        },
      });

      return { previous };
    },
    onError: (_error, _input, context) => {
      // Rolled back rather than left hopeful. A timer that appears and then silently is not
      // running is worse than one that never appeared: you would trust it and lose the block.
      queryClient.setQueryData(focusKeys.running, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: focusKeys.all }),
  });
}

/** Stopping is one tap with no body, and optimistic for the same reason as starting. */
export function useStopSession(): UseMutationResult<FocusSession, ApiError, { id: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }) => api.post<FocusSession>(`/focus/sessions/${id}/stop`),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: focusKeys.running });
      const previous = queryClient.getQueryData<RunningResponse>(focusKeys.running);
      queryClient.setQueryData<RunningResponse>(focusKeys.running, { session: null });
      return { previous };
    },
    onError: (_error, _input, context) => {
      queryClient.setQueryData(focusKeys.running, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: focusKeys.all }),
  });
}

/**
 * The debrief is *not* optimistic. It is a considered answer rather than a capture, it is not
 * on the ≤5s budget, and its failure needs to be visible — a rating that silently did not save
 * is a data loss you would never notice.
 */
export function useDebriefSession(): UseMutationResult<
  FocusSession,
  ApiError,
  { id: string; debrief: DebriefFocusSessionInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, debrief }) =>
      api.post<FocusSession>(`/focus/sessions/${id}/debrief`, debrief),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: focusKeys.all }),
  });
}
