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
 * Everything the activity grid reads (§3.9).
 *
 * **Cells come from `daily_activity` and nothing else.** §3.9 is explicit, and the reason is not
 * only speed: the rollup is where the ember/slag attribution happens, so a grid that re-derived it
 * from raw sessions would be a second implementation of the product's headline number.
 *
 * The plan read sits on the same port despite belonging to another module's tables because it is
 * not a source of cell values — it exists solely to derive `plannedDaysPerWeek` for the one derived
 * line beneath the grid. Keeping it here means the endpoint has one collaborator, and it cannot
 * accidentally become a second input to a cell.
 */
export interface ActivityGridReader {
  daysIn(userId: string, range: DayRange): Promise<ActivityRows>;

  /**
   * Total planned minutes of the most recent weekly plan whose `week_start` falls in `weeks`.
   *
   * Null when there is no plan in that span — which is the common case and must stay
   * distinguishable from a plan that allocates nothing.
   */
  plannedMinutesInForce(userId: string, weeks: DayRange): Promise<number | null>;
}
