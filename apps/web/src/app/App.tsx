import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { useMe } from "../features/auth/api/use-me.js";
import { useSupabaseSession } from "../features/auth/api/use-supabase-session.js";
import { guessLocaleFromBrowser } from "../shared/lib/i18n.js";
import { OfflineQueueProvider } from "../shared/lib/queue-context.js";
import { createQueryClient, I18nProvider } from "./providers.js";
import { createAppRouter } from "./router.js";

/**
 * Everything that has to exist around the route tree.
 *
 * The tree itself is `router.tsx` and the chrome is `Shell.tsx`; what is left here is the ordering
 * of the four providers, which is the part that is easy to get subtly wrong.
 */
export function App(): React.JSX.Element {
  // Created once. A new QueryClient per render would discard every cached response, and a locale
  // change would silently become a full refetch of the app.
  const queryClient = useMemo(() => createQueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <LocalisedApp />
    </QueryClientProvider>
  );
}

/**
 * Resolves the interface language before rendering anything that has words in it.
 *
 * The browser's guess covers the sign-in screen, where there is no profile to read yet. Once there
 * is a session the profile wins, because that is the locale the API translates its error `detail`
 * strings from — a client that kept guessing would show a Portuguese interface with English errors,
 * or the reverse.
 *
 * The router's context carries `timezone` and `weekStartsOn` for the same reason a route needs them
 * at all: `/weeks/$weekStart` has to resolve "this week" from the user's own calendar, and deriving
 * it from the browser would put the plan grid on a different week than the rollup (FR-L5, §5.2).
 */
function LocalisedApp() {
  const browserLocale = useMemo(() => guessLocaleFromBrowser(), []);
  const { session } = useSupabaseSession();
  const signedIn = session != null;
  const me = useMe(signedIn);

  useClearCacheOnSignOut(signedIn);

  // One router for the app's lifetime. Rebuilding it would reset history, so the context is updated
  // through the provider rather than by constructing a new one when the profile arrives.
  const router = useMemo(
    () => createAppRouter({ signedIn: false, timezone: "UTC", weekStartsOn: 1 }),
    [],
  );

  return (
    <I18nProvider locale={me.data?.locale ?? browserLocale}>
      {/* Inside Query because the queue sends through the http client; outside the screens because
          every capture path enqueues into the same one. Here rather than around `LocalisedApp`
          because it needs the user id: IndexedDB is per-origin, so one key would mean one queue for
          the device, and a sign-out with unsent captures would replay them into the next account. */}
      <OfflineQueueProvider userId={session?.user.id}>
        <RouterProvider
          router={router}
          context={{
            signedIn,
            timezone: me.data?.timezone ?? "UTC",
            weekStartsOn: me.data?.weekStartsOn ?? 1,
          }}
        />
      </OfflineQueueProvider>
    </I18nProvider>
  );
}

/**
 * Empty the query cache the moment a session ends.
 *
 * The `QueryClient` is created once for the app's lifetime, `signOut()` only clears Supabase's own
 * storage, and **no query key is scoped by user** — so signing out and signing in as somebody else
 * in the same tab left every cached answer in place. `["me"]` has `staleTime: Infinity`, which made
 * it the worst of them: the second user rendered with the first user's locale, timezone and week
 * start, so every "day" and "week" on their screen was bucketed by a zone they had never chosen.
 * Entity lists served the first user's rows until each one happened to refetch.
 *
 * Keyed off the session transition rather than off the sign-out button, because a session can end
 * without anyone pressing it: an expired refresh token, or a sign-out in another tab, both arrive
 * through `onAuthStateChange` and neither goes near that handler.
 *
 * `clear()` rather than `invalidateQueries()`: invalidating leaves the stale data in place and
 * refetches, so the previous user's rows stay on screen until the network answers.
 */
function useClearCacheOnSignOut(signedIn: boolean): void {
  const queryClient = useQueryClient();
  // Starts as `false` so that arriving already-signed-in is not read as a transition. The first
  // render's session is `undefined` — not yet known — which is also not signed in.
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (wasSignedIn.current && !signedIn) queryClient.clear();
    wasSignedIn.current = signedIn;
  }, [signedIn, queryClient]);
}
