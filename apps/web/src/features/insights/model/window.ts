import { addDays, BACKLOG_WINDOW_DAYS, dayBounds, localDay, type IsoDate } from "@mindforge/core";
import { now } from "../../../shared/lib/clock.js";

/**
 * The spans the three panels read, resolved once from the user's own calendar.
 *
 * Derived here rather than in the route so that nothing on the screen reads the wall clock twice: a
 * range recomputed on every render is a new query key on every render, and the grid would refetch
 * forever. The route memoises one call to this per timezone.
 */

/**
 * A year of days, which is what §3.9 means by the grid.
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
  /**
   * The instant the friction window opens — the first moment of a local day, not a subtraction from
   * the current instant. "The last 28 days" has to start at a day boundary, or the window slides by
   * however many hours into the day it happens to be when you open the screen.
   */
  readonly frictionSince: string;
  /** Shared by the friction and backlog panels so the two describe the same span. */
  readonly windowDays: number;
}

export function insightsWindow(timeZone: string): InsightsWindow {
  const today = localDay(now(), timeZone);
  const windowStart = addDays(today, -(BACKLOG_WINDOW_DAYS - 1));

  return {
    today,
    gridFrom: addDays(today, -(GRID_DAYS - 1)),
    gridTo: today,
    frictionSince: dayBounds(windowStart, timeZone).start.toISOString(),
    windowDays: BACKLOG_WINDOW_DAYS,
  };
}
