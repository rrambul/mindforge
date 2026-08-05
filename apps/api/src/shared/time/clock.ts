import { Injectable } from "@nestjs/common";

/**
 * Time as a dependency.
 *
 * Every "day", "week", and nightly rollup in this product derives from the
 * user's IANA timezone rather than server-local time, and none of that is
 * testable if a use case can reach for the wall clock. The repo-wide ESLint rule
 * banning an argless `new Date()` is the enforcement; this is the one sanctioned
 * exception.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol("Clock");

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    // The single place in the codebase allowed to read the wall clock. Everything
    // else injects Clock, which is what makes timezone-derived rollups testable.
    // eslint-disable-next-line no-restricted-syntax
    return new Date();
  }
}

/** For tests: a clock that does not move unless you move it. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(instant: Date): void {
    this.current = instant;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
