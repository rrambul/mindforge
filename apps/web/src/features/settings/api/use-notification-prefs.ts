import type { NotificationPref, UpdateNotificationPrefsInput } from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";
import type { RequestError } from "../../../shared/api/problem.js";

interface PrefsResponse {
  readonly prefs: readonly NotificationPref[];
}

/**
 * Its own root rather than `["me", "notification-prefs"]`.
 *
 * Query keys match by prefix, so nesting it under `me` would make every settings patch invalidate the
 * preferences too — a theme change refetching the nudge schedule for no reason.
 */
export const notificationPrefKeys = {
  all: ["notification-prefs"] as const,
};

/**
 * The *effective* preferences: stored rows merged over the defaults, resolved server-side.
 *
 * An account with no rows gets every kind on at its defaults rather than an empty list, because
 * "quiet by default" is a delivery decision and not an off switch (FR-N4). Nothing here has to know
 * that — the endpoint answers with the full set either way, and a client that filled the gaps itself
 * would be a second copy of the defaults to keep in step.
 */
export function useNotificationPrefs(): UseQueryResult<PrefsResponse> {
  return useQuery({
    queryKey: notificationPrefKeys.all,
    queryFn: ({ signal }) => api.get<PrefsResponse>("/me/notification-prefs", signal),
    staleTime: Infinity,
  });
}

/**
 * PUT, because each named row is replaced whole — sending it twice leaves the same state.
 *
 * Not queued offline. Changing when you would like to be nudged is a considered decision about a
 * schedule, not a capture, and a replay landing hours later against a form you have since changed
 * again would silently undo the newer answer.
 */
export function useSaveNotificationPrefs(): UseMutationResult<
  PrefsResponse,
  RequestError,
  UpdateNotificationPrefsInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body) => api.put<PrefsResponse>("/me/notification-prefs", body),
    // The response is the full effective set, so it answers the question the next GET would.
    onSuccess: (updated) => queryClient.setQueryData(notificationPrefKeys.all, updated),
  });
}
