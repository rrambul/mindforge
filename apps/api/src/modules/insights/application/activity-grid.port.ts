import type { ActivityDay, IsoDate } from "@mindforge/core";

export const ACTIVITY_GRID_READER = Symbol("ActivityGridReader");

/** A closed range of calendar days, already expressed in the user's timezone. */
export interface DayRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export interface ActivityRows {
  readonly days: readonly ActivityDay[];
  /**
   * The most recent `daily_activity.rebuilt_at` in the range, or null when the range has no rows.
   *
   * The column exists for exactly one consumer, and this is it: a stale grid and an empty grid are
   * otherwise indistinguishable, and a nightly job is the thing most likely to fail quietly.
   */
  readonly rebuiltAt: Date | null;
}

/**
 * Everything the activity grid reads (FR-Q1, FR-Q2).
 *
 * **Cells come from `daily_activity` and nothing else.** The rollup is the one
 * stored derivation the product allows itself, and a grid that re-derived
 * minutes from raw sessions would be a second implementation of it.
 */
export interface ActivityGridReader {
  daysIn(userId: string, range: DayRange): Promise<ActivityRows>;
}
