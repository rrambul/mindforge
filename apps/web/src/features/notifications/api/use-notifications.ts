import type { NotificationKind } from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";
import type { RequestError } from "../../../shared/api/problem.js";

/** Mirrors the API's `NotificationView`. */
export interface Nudge {
  readonly id: string;
  readonly kind: NotificationKind;
  /**
   * ICU **arguments** for the message keyed by `kind` — never rendered text, so the same row reads
   * in either language (§5.2). Untyped here for the same reason the API leaves it untyped: the shape
   * belongs to the message, the message lives in the locale bundle, and a mirror of it in this file
   * would be a second place to update every time a nudge gains an argument.
   */
  readonly payload: Readonly<Record<string, unknown>>;
  /** What tapping it should open. Null for a nudge about the week rather than about a thing. */
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly createdAt: string;
  readonly dismissedAt: string | null;
}

interface NudgeResponse {
  readonly notifications: readonly Nudge[];
}

export const notificationKeys = {
  all: ["notifications"] as const,
};

/**
 * The undismissed nudges, newest first. The only list there is.
 *
 * FR-N5 rules out anything that accumulates into a backlog of things you failed to act on, so a
 * dismissed nudge is gone rather than archived somewhere you can browse and feel bad about.
 *
 * Polled on an interval rather than only on mount, because these are raised by a nightly job against
 * a tab that may have been open since yesterday — but slowly, and never in the background: a request
 * every five minutes from a hidden tab is battery for nothing.
 */
export function useNudges(enabled = true): UseQueryResult<NudgeResponse> {
  return useQuery({
    queryKey: notificationKeys.all,
    queryFn: ({ signal }) => api.get<NudgeResponse>("/notifications", signal),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Dismissing one (FR-N3).
 *
 * Optimistic: the row leaves the list on the tap and comes back if the server refuses. A dismissal
 * that waits for a round trip before anything happens is a button you press twice.
 *
 * Not queued offline, unlike a friction tap. The queue exists for data that would otherwise be
 * *lost* — a nudge you failed to dismiss is still there to dismiss again, and the same row replayed
 * later would be a no-op the server already treats as idempotent.
 */
export function useDismissNudge(): UseMutationResult<
  Nudge,
  RequestError,
  { id: string },
  { previous: NudgeResponse | undefined }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }) => api.post<Nudge>(`/notifications/${id}/dismiss`),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });
      const previous = queryClient.getQueryData<NudgeResponse>(notificationKeys.all);
      if (previous) {
        queryClient.setQueryData<NudgeResponse>(notificationKeys.all, {
          notifications: previous.notifications.filter((nudge) => nudge.id !== id),
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(notificationKeys.all, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
