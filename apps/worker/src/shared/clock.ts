/**
 * The Nest token for the shared `Clock`.
 *
 * The port and both implementations live in `@mindforge/core`; this file exists only because a DI
 * token is a fact about a framework and `packages/core` is imported by the SPA. `apps/api` has the
 * same three lines for the same reason — and the token being a distinct `Symbol` per app is correct,
 * since the two DI containers never meet.
 */

export { FixedClock, SystemClock, type Clock } from "@mindforge/core";

export const CLOCK = Symbol("Clock");
