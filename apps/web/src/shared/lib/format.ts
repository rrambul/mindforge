import type { IsoDate } from "@mindforge/core";

/**
 * The SPA's `Intl` seam.
 *
 * CLAUDE.md's conventions say dates, numbers and durations are formatted with `Intl` or a
 * `packages/core` helper and never by hand, and until the insights screen there was not one `Intl.`
 * call in `apps/web` — every string the user read was either already text or a bare integer. A
 * hand-built `${hours}h ${minutes}m` is wrong in pt-BR, and a hand-built date is wrong everywhere.
 *
 * Formatters are cached because construction is the expensive part by a wide margin: the activity
 * grid formats a label for 365 cells in one render, and a fresh `DateTimeFormat` per cell is the
 * difference between a grid that appears and one that stutters. `packages/core`'s calendar module
 * caches for exactly the same reason.
 */

const formatters = new Map<string, unknown>();

function cached<T>(key: string, build: () => T): T {
  const hit = formatters.get(key);
  if (hit !== undefined) return hit as T;
  const created = build();
  formatters.set(key, created);
  return created;
}

/**
 * A wall-calendar date, spelled out.
 *
 * Formatted **in UTC on purpose**. An `IsoDate` is already a date in the user's own calendar —
 * `daily_activity.day` is written that way by the rollup, and `packages/core` manipulates it as a
 * plain string precisely so no offset rides along. Passing the profile's timezone here would apply
 * the offset a second time and move half the grid one day left of where it belongs.
 */
export function formatDay(day: IsoDate, locale: string): string {
  return cached(
    `day:${locale}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: "UTC",
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
  ).format(midnightUtc(day));
}

/** Just the month, for the axis above the grid. */
export function formatMonth(day: IsoDate, locale: string): string {
  return cached(
    `month:${locale}`,
    () => new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short" }),
  ).format(midnightUtc(day));
}

/**
 * A real instant, in the user's timezone.
 *
 * The opposite case to `formatDay`, and the reason they are two functions rather than one with a
 * flag: an instant genuinely needs the profile's zone, and a date genuinely must not have one.
 */
export function formatInstant(instant: string, locale: string, timeZone: string): string {
  return cached(
    `instant:${locale}:${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }),
  ).format(new Date(instant));
}

/** 0 = Sunday, matching `dayOfWeek` and `Profile.weekStartsOn`. */
export function formatWeekday(weekday: number, locale: string): string {
  // 2024-01-07 was a Sunday, so the offset lands on the named day whatever the locale's own week
  // order is — the argument is a weekday number, not a position in someone's week.
  return cached(
    `weekday:${locale}`,
    () => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long" }),
  ).format(new Date(Date.UTC(2024, 0, 7 + weekday)));
}

/**
 * Minutes as hours and minutes, in the locale's own units.
 *
 * `Intl.DurationFormat` would be the one-call answer and is too new to rely on, so this is the
 * two-unit list `Intl.ListFormat`'s `unit` type exists for: "2 hr 15 min" in English, "2 h 15 min"
 * in Portuguese, and neither of them assembled from a hardcoded letter.
 */
export function formatMinutes(total: number, locale: string): string {
  const whole = Math.max(0, Math.round(total));
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(unit(hours, "hour", locale));
  // Zero prints as "0 min" rather than as nothing: this is the label on a cell, and an empty
  // duration would read as a rendering failure.
  if (minutes > 0 || hours === 0) parts.push(unit(minutes, "minute", locale));

  return cached(
    `list:${locale}`,
    () => new Intl.ListFormat(locale, { style: "narrow", type: "unit" }),
  ).format(parts);
}

function unit(value: number, name: "hour" | "minute", locale: string): string {
  return cached(
    `unit:${name}:${locale}`,
    () => new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "short" }),
  ).format(value);
}

/** A 0–1 fraction as a percentage. Whole numbers: a share to one decimal implies precision. */
export function formatPercent(fraction: number, locale: string): string {
  return cached(
    `percent:${locale}`,
    () => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }),
  ).format(fraction);
}

function midnightUtc(day: IsoDate): Date {
  return new Date(`${day}T00:00:00Z`);
}
