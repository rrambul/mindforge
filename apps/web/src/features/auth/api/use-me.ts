import type { Locale, WeekStart } from "@mindforge/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";

/** Mirrors the API's MeView. */
export interface Me {
  readonly userId: string;
  readonly locale: Locale;
  /** IANA. Every "day" and "week" the client renders derives from this. */
  readonly timezone: string;
  readonly weekStartsOn: WeekStart;
}

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
    queryFn: ({ signal }) => api.get<Me>("/me", signal),
    // Without this, an unauthenticated app 401s on every mount before the sign-in form
    // has even rendered.
    enabled,
    // Locale, timezone, and week start change only when the user changes them, and that
    // mutation will invalidate this. Until then there is nothing to refetch for.
    staleTime: Infinity,
  });
}
