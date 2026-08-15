import { MeViewSchema, type MeView } from "@mindforge/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";

/**
 * The API's own shape, from `packages/core`.
 *
 * **All seven fields, though this hook reads four.** It used to be declared here
 * as the narrow subset it needed, which was fine while nothing checked the wire
 * and became a bug the moment something did: this query and
 * `features/settings`'s share the cache key `["me"]` on purpose, so whichever
 * runs first fills that entry — and a narrow schema strips unknown keys, leaving
 * the settings screen reading a row with three fields missing.
 *
 * One key, one schema. `useProfile` documents the other half of this.
 */
export type Me = MeView;

export const meKeys = {
  me: ["me"] as const,
};

/**
 * The profile, which decides what language the interface is in.
 *
 * Fetched rather than guessed: the API translates every error's `detail` from the stored
 * locale (§5.2), so a client that read the browser's language instead would show its own
 * copy in one language and every error in another.
 */
export function useMe(enabled: boolean): UseQueryResult<Me> {
  return useQuery({
    queryKey: meKeys.me,
    queryFn: ({ signal }) => api.get("/me", MeViewSchema, signal),
    // Without this, an unauthenticated app 401s on every mount before the sign-in form
    // has even rendered.
    enabled,
    // Locale, timezone, and week start change only when the user changes them, and that
    // mutation will invalidate this. Until then there is nothing to refetch for.
    staleTime: Infinity,
  });
}
