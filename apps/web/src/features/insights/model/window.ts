import { addDays, localDay, type IsoDate } from "@mindforge/core";
import { now } from "../../../shared/lib/clock.js";

/**
 * The span the grid reads, resolved once from the user's own calendar.
 *
 * Derived here rather than in the route so that nothing on the screen reads the wall clock twice: a
 * range recomputed on every render is a new query key on every render, and the grid would refetch
 * forever. The route memoises one call to this per timezone.
 */

/**
 * A year of days, which is what FR-Q1 means by the grid.
 *
 * 365 rather than `MAX_GRID_DAYS`: the bound exists so one request cannot ask for a decade, and
 * asking for the largest legal range would leave no room to widen the window later without hitting
 * a 422.
 */
export const GRID_DAYS = 365;

export interface InsightsWindow {
  /** Today, in the user's timezone. */
  readonly today: IsoDate;
  readonly gridFrom: IsoDate;
  readonly gridTo: IsoDate;
}

export function insightsWindow(timeZone: string): InsightsWindow {
  const today = localDay(now(), timeZone);

  return {
    today,
    gridFrom: addDays(today, -(GRID_DAYS - 1)),
    gridTo: today,
  };
}
