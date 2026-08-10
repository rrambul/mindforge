/**
 * The activity grid — the frequency tracker (FR-Q1, §3.9).
 *
 * The familiar shape with one deliberate refusal: **no streak counter.** The
 * companion figure is active days in the last 28, which recovers naturally and
 * cannot be broken by one bad week. An empty cell is neutral, because rest
 * days are part of the design and there is no shading of shame.
 *
 * Two decisions this module makes that §3.9 leaves open:
 *
 * 1. **Intensity is relative to your own history, not to an absolute scale.**
 *    The four steps are quartiles of your own non-empty days across the
 *    window. A thirty-minute day is a real day for someone whose days are
 *    thirty minutes, and an absolute scale would render their entire year as
 *    the palest shade — which says nothing and reads as failure.
 *
 * 2. **At most one signal line, and only when it is true and actionable.**
 *    "You have never once logged a Saturday" is a fact about your life no
 *    other view would ever surface.
 */

import { activeDaysIn, dayOfWeek, eachDay, type IsoDate } from "../time/calendar.js";

/** A `daily_activity` row, flattened. The grid reads this and never raw sessions (FR-Q2). */
export interface ActivityDay {
  readonly day: IsoDate;
  readonly focusMinutes: number;
}

export interface GridCell {
  readonly day: IsoDate;
  /** Focus minutes. */
  readonly value: number;
  /** 0–4. Zero means nothing happened; 1–4 are quartiles of your own non-empty days. */
  readonly intensity: number;
}

/** A fact worth a sentence beneath the grid, or null when there is not one. */
export type GridSignal = { readonly kind: "never_on_weekday"; readonly weekday: number } | null;

export interface ActivityGrid {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** One cell per day in the range, in order, including the empty ones. */
  readonly cells: readonly GridCell[];
  /** The figure that replaces a streak: it degrades gracefully and cannot be broken by one bad week. */
  readonly activeDaysIn28: number;
  readonly signal: GridSignal;
}

export interface GridOptions {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export function buildGrid(days: Iterable<ActivityDay>, options: GridOptions): ActivityGrid {
  const byDay = new Map<IsoDate, ActivityDay>();
  for (const day of days) byDay.set(day.day, day);

  const range = eachDay(options.from, options.to);
  const values = range.map((day) => byDay.get(day)?.focusMinutes ?? 0);

  const steps = quartiles(values.filter((v) => v > 0));

  const cells: GridCell[] = range.map((day, index) => {
    const value = values[index]!;
    return { day, value, intensity: bucket(value, steps) };
  });

  const activeDays = range.filter((day) => (byDay.get(day)?.focusMinutes ?? 0) > 0);

  return {
    from: options.from,
    to: options.to,
    cells,
    activeDaysIn28: activeDaysIn(activeDays, options.to, 28),
    signal: signalFor(activeDays, options),
  };
}

/**
 * Three cut points splitting your non-empty days into four groups of roughly equal size.
 *
 * Nearest-rank rather than interpolated: the steps are compared against real values, and an
 * interpolated cut of 47.5 minutes on a history where every day is 45 or 50 makes the boundary land
 * somewhere no day actually is.
 */
function quartiles(nonEmpty: readonly number[]): readonly [number, number, number] | null {
  if (nonEmpty.length === 0) return null;
  const sorted = [...nonEmpty].sort((a, b) => a - b);
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]!;
  return [at(0.25), at(0.5), at(0.75)];
}

function bucket(value: number, steps: readonly [number, number, number] | null): number {
  if (value <= 0) return 0;
  // Unreachable: steps are null only when no day had a value, and then no cell reaches here.
  /* v8 ignore next */
  if (steps === null) return 1;
  if (value <= steps[0]) return 1;
  if (value <= steps[1]) return 2;
  if (value <= steps[2]) return 3;
  return 4;
}

/**
 * At most one line, and only when it is true and actionable. Needs a real
 * history behind it: over eight weeks, "never on a Saturday" is eight
 * Saturdays.
 */
function signalFor(activeDays: readonly IsoDate[], options: GridOptions): GridSignal {
  const span = eachDay(options.from, options.to);
  if (span.length >= 56 && activeDays.length >= 10) {
    const seen = new Set(activeDays.map(dayOfWeek));
    for (let weekday = 0; weekday < 7; weekday += 1) {
      if (!seen.has(weekday)) return { kind: "never_on_weekday", weekday };
    }
  }
  return null;
}
