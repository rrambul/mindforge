/**
 * The activity grid (FR-I6b, §3.9).
 *
 * The familiar shape, deliberately not the familiar semantics. GitHub's grid encodes one thing —
 * volume — and darker is better. For this product that is exactly backwards: a dark day of thrashing
 * on broken tooling would render as your best week, and volume is the vanity metric the whole thesis
 * rejects. So a cell carries two channels: **intensity from minutes, hue from ember share**. A heavy
 * grey cell reads as "you spent a lot and got little". An empty cell is neutral, because rest days
 * are part of the design and there is no shading of shame.
 *
 * Three decisions this module makes that §3.9 leaves open:
 *
 * 1. **Intensity is relative to your own history, not to an absolute scale.** The four steps are
 *    quartiles of your own non-empty days across the window. A thirty-minute day is a real day for
 *    someone whose days are thirty minutes, and an absolute scale would render their entire year as
 *    the palest shade — which says nothing and reads as failure.
 *
 * 2. **`emberShare` is null on a day with no logged friction, and the cell renders neutral rather
 *    than grey.** Grey means "you spent this and got little", which is a measurement. A day you
 *    simply did not annotate has not been measured, and §3.9's own reading of a grey cell would be
 *    a lie about it.
 *
 * 3. **Only the layers with a source exist.** §3.9 names five — focus, reviews, lessons, notes,
 *    artifacts — and three of them have no table until M4–M6. A switcher offering layers that are
 *    flat by construction teaches you the grid is decoration. They arrive with their data.
 */

import { emberShare as shareOf } from "../friction/split.js";
import { activeDaysIn, addDays, dayOfWeek, eachDay, type IsoDate } from "../time/calendar.js";

/** A `daily_activity` row, flattened. The grid reads this and never raw sessions (§3.9). */
export interface ActivityDay {
  readonly day: IsoDate;
  readonly focusMinutes: number;
  readonly emberMinutes: number;
  readonly slagMinutes: number;
  readonly notesCaptured: number;
}

/**
 * The layers that have a source in M2.
 *
 * `reviews`, `lessons` and `artifacts` are absent rather than disabled: the union is what the API
 * validates against, so an unbuilt layer cannot be requested and then answered with zeroes.
 */
export const GRID_LAYERS = ["focus", "notes"] as const;
export type GridLayer = (typeof GRID_LAYERS)[number];

export interface GridCell {
  readonly day: IsoDate;
  /** The layer's own unit — minutes for focus, a count for notes. */
  readonly value: number;
  /** 0–4. Zero means nothing happened; 1–4 are quartiles of your own non-empty days. */
  readonly intensity: number;
  /**
   * Productive share of the day's attributed friction, 0–1, or null when none was logged.
   *
   * Present on every layer, not just focus: a day's temper is a fact about the day, and dimming the
   * hue when you switch to notes would imply the note-taking was the slag.
   */
  readonly emberShare: number | null;
}

/** A fact worth a sentence beneath the grid, or null when there is not one. */
export type GridSignal =
  | {
      readonly kind: "pace_below_plan";
      readonly averageActiveDays: number;
      readonly plannedDays: number;
    }
  | { readonly kind: "never_on_weekday"; readonly weekday: number }
  | null;

export interface ActivityGrid {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly layer: GridLayer;
  /** One cell per day in the range, in order, including the empty ones. */
  readonly cells: readonly GridCell[];
  /** The figure that replaces a streak: it degrades gracefully and cannot be broken by one bad week. */
  readonly activeDaysIn28: number;
  readonly signal: GridSignal;
}

export interface GridOptions {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly layer?: GridLayer;
  /**
   * How many days a week your plans assume, when there is a plan. Feeds the one signal §3.9 gives
   * as an example: "your last four weeks average 3.2 active days; your weekly plans assume 5".
   */
  readonly plannedDaysPerWeek?: number | null;
}

function valueOf(day: ActivityDay, layer: GridLayer): number {
  return layer === "focus" ? day.focusMinutes : day.notesCaptured;
}

export function buildGrid(days: Iterable<ActivityDay>, options: GridOptions): ActivityGrid {
  const layer = options.layer ?? "focus";
  const byDay = new Map<IsoDate, ActivityDay>();
  for (const day of days) byDay.set(day.day, day);

  const range = eachDay(options.from, options.to);
  const values = range.map((day) => {
    const row = byDay.get(day);
    return row === undefined ? 0 : valueOf(row, layer);
  });

  const steps = quartiles(values.filter((v) => v > 0));

  const cells: GridCell[] = range.map((day, index) => {
    const row = byDay.get(day);
    const value = values[index]!;
    return {
      day,
      value,
      intensity: bucket(value, steps),
      emberShare: row === undefined ? null : shareOf(row.emberMinutes, row.slagMinutes),
    };
  });

  // "Active" is measured on focus, whatever layer is being drawn. It is a statement about whether
  // you showed up, and switching the grid to notes must not change the answer.
  const activeFocusDays = range.filter((day) => (byDay.get(day)?.focusMinutes ?? 0) > 0);

  return {
    from: options.from,
    to: options.to,
    layer,
    cells,
    activeDaysIn28: activeDaysIn(activeFocusDays, options.to, 28),
    signal: signalFor(activeFocusDays, options),
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
 * At most one line, and only when it is true and actionable.
 *
 * The weekday observation goes first because it is the one the grid is genuinely good at surfacing
 * — "you have never once logged a Saturday" is a fact about your life your weekly plan should
 * probably respect, and no other view would ever tell you.
 */
function signalFor(activeDays: readonly IsoDate[], options: GridOptions): GridSignal {
  const span = eachDay(options.from, options.to);
  // Needs a real history behind it. Over four weeks, "never on a Saturday" is four Saturdays.
  if (span.length >= 56 && activeDays.length >= 10) {
    const seen = new Set(activeDays.map(dayOfWeek));
    for (let weekday = 0; weekday < 7; weekday += 1) {
      if (!seen.has(weekday)) return { kind: "never_on_weekday", weekday };
    }
  }

  const planned = options.plannedDaysPerWeek;
  if (planned !== null && planned !== undefined && planned > 0) {
    const fourWeeksAgo = addDays(options.to, -27);
    const recent = activeDays.filter((day) => day >= fourWeeksAgo).length;
    const average = recent / 4;
    // Three-quarters of the plan, not any shortfall: a plan is a target, and a line every week
    // about missing it by half a day is the nagging FR-N4 exists to prevent.
    if (average < planned * 0.75) {
      return {
        kind: "pace_below_plan",
        averageActiveDays: Math.round(average * 10) / 10,
        plannedDays: planned,
      };
    }
  }

  return null;
}
