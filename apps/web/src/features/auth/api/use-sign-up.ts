import { defaultWeekStartsOn, type UpdateProfileInput } from "@mindforge/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "../../../shared/api/http.js";
import { supabase } from "../../../shared/api/supabase.js";
import { browserTimeZone, guessLocaleFromBrowser } from "../../../shared/lib/i18n.js";

/**
 * Creating the account, then telling it which calendar it lives in (FR-L1, FR-L2, FR-L3, FR-L5).
 *
 * The profile row is created by a trigger on `auth.users`, which is the only thing that can create
 * it — Prisma cannot own that table — and a trigger knows nothing about the browser that signed up.
 * So every account started at `timezone: 'UTC'`, `locale: 'en'` and `weekStartsOn: 1` regardless of
 * where or who it was, and FR-L5's "seeded from locale" described a column nobody wrote:
 * `defaultWeekStartsOn` existed in `packages/core`, with tests, and had no callers.
 *
 * That is not a cosmetic default. A pt-BR user's weekly plan grid opened on Monday while their
 * calendar starts Sunday, and every "today" and "this week" — the plan, the review, the nightly
 * rollup, the activity grid — bucketed by UTC. §5.2's rule is that all of those derive from the
 * user's own zone, and until this ran they derived from nobody's.
 *
 * **Seeded once, here, rather than derived on read.** FR-L5 makes the week start a user preference,
 * so it has to be a stored value the user can then own: deriving it from the locale at render time
 * would silently re-bucket last quarter's weeks the moment somebody switched their interface to
 * English. That is also why this cannot move to `LocalisedApp` or a first-request hook — a profile
 * sitting at UTC/Monday is indistinguishable from one where the user chose UTC and Monday.
 */
export function useSignUp(): (
  email: string,
  password: string,
) => Promise<{ readonly error: unknown }> {
  const queryClient = useQueryClient();

  return useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) return { error };

      await seed(queryClient);
      return { error: null };
    },
    [queryClient],
  );
}

/**
 * What the browser can tell us, which is all there is to go on at signup.
 *
 * `contentLanguage` follows the interface rather than defaulting to English, because FR-L3 says it
 * defaults to the UI locale — separately overridable afterwards, which is the whole point of it
 * being its own column.
 */
function browserSeed(): UpdateProfileInput {
  const locale = guessLocaleFromBrowser();
  return {
    locale,
    contentLanguage: locale,
    timezone: browserTimeZone(),
    weekStartsOn: defaultWeekStartsOn(locale),
  };
}

/**
 * Not fatal, and not silent either.
 *
 * The account exists by the time this runs — `signUp` already succeeded — so reporting a failure
 * here as a failed sign-up would be a lie, and the retry it invites answers "already registered".
 * Every seeded field is reachable from Settings, so the recovery is real rather than theoretical.
 * It still gets said out loud: a profile quietly on the wrong calendar makes every week on screen
 * wrong in a way that looks like the app's arithmetic rather than its setup.
 */
async function seed(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  try {
    await api.patch("/me", browserSeed());
  } catch (cause) {
    console.error("Could not seed the new profile's locale, timezone and week start", cause);
    return;
  }

  /**
   * Everything, rather than the profile key.
   *
   * `onAuthStateChange` fires inside `signUp` above, so the app is already signed in and `useMe` has
   * already gone out for a profile that this request then changed — and `["me"]` has
   * `staleTime: Infinity`, so the losing order sticks for the whole session: the first screen after
   * signup renders on UTC and Monday and nothing ever refetches to correct it.
   *
   * The key itself belongs to `features/settings`, which this feature may not import (§2.2 rule 6),
   * and an enumeration of another feature's keys is a list that is right until someone renames one.
   * A signup has nothing else cached, so invalidating everything costs a refetch of exactly the
   * queries a new account was about to run anyway.
   */
  await queryClient.invalidateQueries();
}
