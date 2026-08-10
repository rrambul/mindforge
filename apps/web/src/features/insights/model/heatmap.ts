import { dayOfWeek, type GridCell, type IsoDate, type WeekStart } from "@mindforge/core";

/**
 * Where a year of cells lands on a seven-row grid.
 *
 * Pure, and separated from the component, because this is the arithmetic that silently ruins a
 * heatmap: get the leading offset wrong and every cell is a day out, which nothing about the
 * rendering makes obvious — the grid still looks like a grid.
 */

/**
 * How many empty slots precede the first cell.
 *
 * Measured from the user's own week start, never the locale's (FR-L5): the row a Monday sits on has
 * to match the row the weekly plan calls day one, and re-deriving it from the interface language
 * would move the whole grid when someone switches to Portuguese.
 */
export function leadingOffset(first: IsoDate, weekStartsOn: WeekStart): number {
  return (dayOfWeek(first) - weekStartsOn + 7) % 7;
}

export interface MonthMarker {
  /** The first day of the month, for the formatter. */
  readonly day: IsoDate;
  /** 1-based CSS grid column the label sits above. */
  readonly column: number;
}

/**
 * One label per month, above the column its first day falls in.
 *
 * Without an axis a year of squares is unreadable — §3.9's whole claim is that the grid surfaces
 * cadence, and "never once on a Saturday" is not a thing anyone can see in an unlabelled block.
 *
 * A month whose first day is in the leading partial column is skipped: its label would sit at column
 * one on top of the previous month's, and the range starts mid-month by construction.
 */
export function monthMarkers(
  cells: readonly GridCell[],
  weekStartsOn: WeekStart,
): readonly MonthMarker[] {
  if (cells.length === 0) return [];

  const offset = leadingOffset(cells[0]!.day, weekStartsOn);
  const markers: MonthMarker[] = [];

  for (const [index, cell] of cells.entries()) {
    if (!cell.day.endsWith("-01")) continue;
    const column = Math.floor((offset + index) / 7) + 1;
    if (column === 1) continue;
    markers.push({ day: cell.day, column });
  }

  return markers;
}

/**
 * Opacity per intensity step — the minutes channel.
 *
 * Four steps rather than a continuous ramp because `buildGrid` already bucketed into quartiles of
 * your own history — a continuous opacity would imply a precision the quartiles deliberately do not
 * claim. The lowest step stays well clear of the empty cell's own tone so "a little" and "nothing"
 * are never the same square.
 */
const INTENSITY_OPACITY = [0, 0.3, 0.52, 0.76, 1] as const;

export function intensityOpacity(intensity: number): number {
  return INTENSITY_OPACITY[Math.min(Math.max(intensity, 0), 4)] ?? 1;
}
