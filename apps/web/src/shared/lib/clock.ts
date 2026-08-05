/**
 * The browser's one reading of the wall clock.
 *
 * The API injects a `Clock` port and the repo-wide ESLint rule bans a bare `new Date()` for good
 * reason — a use case that reaches for the wall clock is untestable, and every "day" and "week"
 * in this product derives from the user's timezone rather than the machine's.
 *
 * The browser cannot inject a clock through a DI container, but it can still have exactly one
 * place that reads it, which buys the same two things: a test can fake time at a single seam,
 * and there is one file to look at when a timestamp turns out to be wrong.
 *
 * Two callers need it, and both are timestamps the *client* is authoritative for:
 * the optimistic `startedAt` the elapsed ticker reads before the server answers, and the
 * `occurredAt` on a friction tap — which must record when the friction happened rather than when
 * it uploaded, or an afternoon offline arrives as a burst at reconnect.
 *
 * Anything that *formats* a date for display goes through `Intl` with the profile's timezone
 * (§5.2), never through this.
 */

/* eslint-disable no-restricted-syntax -- the one sanctioned wall-clock read in the browser,
   mirroring SystemClock in apps/api. */

export function now(): Date {
  return new Date();
}

export function nowIso(): string {
  return new Date().toISOString();
}
