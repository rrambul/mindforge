/**
 * Time as a dependency.
 *
 * Every "day", "week", and nightly rollup in this product derives from the user's IANA timezone
 * rather than server-local time, and none of that is testable if a use case can reach for the wall
 * clock. The repo-wide ESLint rule banning an argless `new Date()` is the enforcement; `SystemClock`
 * below is the one sanctioned exception.
 *
 * This lives in `packages/core` rather than in `apps/api/src/shared/time/` — where it started —
 * because M2 gives it a second consumer. The nightly rollup runs in `apps/worker`, which cannot
 * import across an app boundary, and the alternative was two classes named `SystemClock` drifting
 * apart. Nothing here imports Nest: the `CLOCK` injection token stays in the API, because a DI token
 * is a fact about one framework and this file is imported by the SPA.
 */

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    // The single place in the codebase allowed to read the wall clock. Everything else takes a
    // Clock, which is what makes timezone-derived rollups testable rather than flaky at midnight.
    // eslint-disable-next-line no-restricted-syntax
    return new Date();
  }
}

/** For tests: a clock that does not move unless you move it. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    // A copy, not the field. A caller that mutates the returned Date must not be able to move
    // everyone else's clock — and a test that did so would fail somewhere unrelated.
    return new Date(this.current.getTime());
  }

  set(instant: Date): void {
    this.current = instant;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
