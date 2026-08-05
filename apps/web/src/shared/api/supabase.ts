import { createClient, type Session } from "@supabase/supabase-js";
import { env } from "../lib/env.js";

/**
 * The one Supabase client in the browser.
 *
 * Its job here is narrow and worth stating: it holds the session and refreshes the
 * access token. The API never issues tokens (TECH-DESIGN.md §4), and the SPA never
 * reads data through Supabase's REST layer — every read and write goes through our
 * own API so that use cases, validation, and the RFC 7807 error shape are the same
 * for every client. A second data path through PostgREST would bypass all of it.
 */
// Inferred rather than annotated `SupabaseClient`: the exported type's generic
// defaults are narrower than what createClient actually returns, so annotating it
// widens `any` into the app instead of constraining anything.
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    // Long-lived tabs are the normal case for this product — you leave it open with
    // a timer running — so a stale token must renew itself rather than surfacing as
    // a 401 in the middle of a focus session.
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * The current access token, or null.
 *
 * Read per request rather than cached: `getSession()` returns the refreshed token
 * after a renewal, and a copy taken once at startup would expire in an hour and start
 * 401ing with no obvious cause.
 */
export async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export type { Session };
