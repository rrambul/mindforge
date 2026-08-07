/**
 * Time as a dependency — the Nest half.
 *
 * The port and both implementations moved to `@mindforge/core` in M2, when the nightly rollup gave
 * them a second consumer in `apps/worker`. What stays here is the one part that is genuinely about
 * this app: the injection token. A DI token is a fact about a framework, and `packages/core` is
 * imported by the SPA.
 *
 * Re-exported rather than left to be imported from two places, so `@Inject(CLOCK) clock: Clock`
 * remains one import line and nothing has to know the port emigrated.
 */

export { FixedClock, SystemClock, type Clock } from "@mindforge/core";

export const CLOCK = Symbol("Clock");
