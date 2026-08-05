import { useEffect, useState } from "react";
import { supabase, type Session } from "../../../shared/api/supabase.js";

/**
 * The Supabase session, kept in React state rather than TanStack Query.
 *
 * This is the exception to "server state lives in Query" (§2.2 rule 1), and the reason
 * is that the session is *pushed*: the SDK emits `onAuthStateChange` on refresh, on
 * sign-out, and on a change in another tab. Modelling a push stream as a poll would mean
 * the app kept using a token the SDK had already replaced.
 *
 * `undefined` means "not yet determined" and is deliberately distinct from `null`, which
 * means signed out. Collapsing them would flash the sign-in screen on every reload while
 * the stored session was still being read.
 *
 * Deliberately not unit-tested: it is a subscription to a third-party SDK, so a jsdom
 * test would assert that a mock emitted what the mock was told to emit. §13.2 assigns
 * "sign up → sign in → sign out" to Playwright, against real Supabase, which is the only
 * level at which this can actually be wrong.
 */
export function useSupabaseSession(): { session: Session | null | undefined } {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { session };
}
