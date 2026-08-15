import {
  FocusSessionListSchema,
  FocusSessionViewSchema,
  RunningFocusSessionSchema,
  type CreateFocusSessionInput,
  type DebriefFocusSessionInput,
  type FocusSessionList,
  type FocusSessionView,
  type StartFocusSessionInput,
} from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";
import { NetworkError, type RequestError } from "../../../shared/api/problem.js";
import { nowIso } from "../../../shared/lib/clock.js";
import { useOfflineQueue } from "../../../shared/lib/queue-context.js";

/**
 * The API's own shape, from `packages/core` — not a copy of it. See
 * `schemas/wire.ts` for why every one of these mirrors moved.
 */
export type FocusSession = FocusSessionView;
type RunningResponse = { readonly session: FocusSession | null };

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
    queryFn: ({ signal }) => api.get("/focus/sessions/running", RunningFocusSessionSchema, signal),
    enabled,
    staleTime: 5_000,
  });
}

/**
 * The most recent page of history.
 *
 * Deliberately the *first* page and not an infinite query: this feeds the Today
 * screen, whose question is "what have I done lately", and the endpoint now
 * returns a `nextCursor` for the screens that will page through the rest. The
 * cursor is carried in the type rather than discarded so that adding
 * `useInfiniteQuery` later is a change to this hook and to nothing that calls it.
 */
export function useRecentSessions(enabled: boolean): UseQueryResult<FocusSessionList> {
  return useQuery({
    queryKey: focusKeys.sessions,
    queryFn: ({ signal }) => api.get("/focus/sessions", FocusSessionListSchema, signal),
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
  RequestError,
  StartFocusSessionInput
> {
  const queryClient = useQueryClient();
  const offline = useOfflineQueue();

  return useMutation({
    mutationFn: (input) => api.post("/focus/sessions/start", FocusSessionViewSchema, input),
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
          // Mirrors the server's own default, so the optimistic row is not briefly a
          // different kind of session than the one that comes back.
          entryMode: input.entryMode ?? "timer",
          hitIntention: null,
          focusQuality: null,
          energy: null,
          note: null,
          missionId: input.missionId ?? null,
          lessonId: input.lessonId ?? null,
        },
      });

      return { previous };
    },
    onError: (error, input, context) => {
      // The distinction that makes offline work: a request that never *arrived* will land later,
      // so the timer stays and the start is queued. A request the server *refused* will never
      // land, so the timer is rolled back — one that appears and then silently is not running is
      // worse than one that never appeared, because you would trust it and lose the block.
      if (error instanceof NetworkError && offline && input.id) {
        void offline.queue.enqueue(`focus:start:${input.id}`, "/focus/sessions/start", input);
        return;
      }
      // `setQueryData` with `undefined` is a no-op in query-core, so this rolled back nothing when
      // the `running` GET had failed and left no cached entry — a server-refused start (409) then
      // kept its optimistic timer on screen for a session that does not exist, and Stop 404s on a
      // client-minted id. `null` is the real previous state in that case: nothing was running.
      queryClient.setQueryData(focusKeys.running, context?.previous ?? { session: null });
    },
    // onSuccess, not onSettled. A queued start must NOT trigger a refetch: the server does not
    // know about the session yet, so `running` would come back null and erase the very optimistic
    // state the queue is there to honour. Intermittent connectivity makes this real rather than
    // theoretical — the GET succeeds while the POST does not.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: focusKeys.all }),
  });
}

/** Stopping is one tap with no body, and optimistic for the same reason as starting. */
export function useStopSession(): UseMutationResult<FocusSession, RequestError, { id: string }> {
  const queryClient = useQueryClient();
  const offline = useOfflineQueue();

  return useMutation({
    mutationFn: ({ id }) => api.post(`/focus/sessions/${id}/stop`, FocusSessionViewSchema),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: focusKeys.running });
      const previous = queryClient.getQueryData<RunningResponse>(focusKeys.running);
      queryClient.setQueryData<RunningResponse>(focusKeys.running, { session: null });
      return { previous };
    },
    onError: (error, input, context) => {
      // Queued rather than rolled back: the block did end, and putting the timer back would tell
      // you it is still running. The stop replays after its start, because the queue is FIFO.
      if (error instanceof NetworkError && offline) {
        void offline.queue.enqueue(
          `focus:stop:${input.id}`,
          `/focus/sessions/${input.id}/stop`,
          {},
        );
        return;
      }
      // Same `undefined` no-op as on start, but the honest fallback is different here. Stopping
      // implies something *was* running, so asserting `{ session: null }` would state the opposite
      // of what we know; and asserting a session we never cached is inventing one. With no snapshot
      // to restore, ask the server instead — the only branch where a refetch is right.
      if (context?.previous === undefined) {
        void queryClient.invalidateQueries({ queryKey: focusKeys.running });
      } else {
        queryClient.setQueryData(focusKeys.running, context.previous);
      }
    },
    // See the note on start: a refetch after a queued stop would report the session as still
    // running and put the timer back.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: focusKeys.all }),
  });
}

/**
 * The debrief is *not* optimistic. It is a considered answer rather than a capture, it is not
 * on the ≤5s budget, and its failure needs to be visible — a rating that silently did not save
 * is a data loss you would never notice.
 */
export function useDebriefSession(): UseMutationResult<
  FocusSession,
  RequestError,
  { id: string; debrief: DebriefFocusSessionInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, debrief }) =>
      api.post(`/focus/sessions/${id}/debrief`, FocusSessionViewSchema, debrief),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: focusKeys.all }),
  });
}

/**
 * FR-F2 — manual and retroactive entry.
 *
 * Not optimistic and not queued. A block you are recording after the fact is not on the ≤5s
 * budget, and unlike a live capture there is no running timer whose state would be wrong while it
 * settled — so the honest behaviour is to wait for the server and report a failure, because the
 * form still holds everything needed to try again.
 */
export function useRecordSession(): UseMutationResult<
  FocusSession,
  RequestError,
  CreateFocusSessionInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => api.post("/focus/sessions", FocusSessionViewSchema, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: focusKeys.all }),
  });
}
