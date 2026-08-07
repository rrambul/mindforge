/**
 * Calendar arithmetic in the user's timezone.
 *
 * This is the module every "day" and every "week" in the product agrees through. The nightly rollup
 * buckets sessions into `daily_activity.day` with it, the API answers `GET /plans/:weekStart` with
 * it, and the SPA draws the activity grid and the planning grid with it. If any two of those
 * disagreed about where Tuesday ends, the grid and the plan would quietly describe different weeks
 * — which is non-negotiable 3 (`packages/core` is the single implementation of domain math) applied
 * to the one kind of maths people assume is free.
 *
 * **Everything here is calendar arithmetic, never millisecond arithmetic.** Adding 86,400,000ms to
 * an instant is wrong twice a year in most of the world, and permanently wrong in the zones with
 * three-quarter-hour offsets — Kathmandu at +05:45, Chatham at +12:45. A day is "the next date on
 * the wall calendar", so the dates are manipulated as dates and only converted to instants at the
 * edge, where a query needs a range.
 *
 * A date here is an `IsoDate`: `YYYY-MM-DD`, no time, no zone. It is what `daily_activity.day` and
 * `weekly_plans.week_start` store, and it is deliberately a plain string — a `Date` at midnight
 * carries a timezone it has no business carrying, and every bug in this area starts with one.
 */

import type { WeekStart } from "../i18n/locales.js";

/** `YYYY-MM-DD`. A date on someone's wall calendar, with no time and no zone attached. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formatters are cached because the rollup builds one per user and then formats every session.
 * Constructing an `Intl.DateTimeFormat` is the expensive part by a wide margin.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timeZone);
  if (cached) return cached;

  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  FORMATTERS.set(timeZone, created);
  return created;
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** What a clock on the wall in `timeZone` reads at `instant`. */
function wallClockAt(instant: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    // Unreachable with the options above, which request every one of these. Guarded rather than
    // asserted because a silent NaN here would put a session on the wrong day, and a day is the
    // unit the whole rollup is keyed on.
    /* v8 ignore next */
    if (!part) throw new RangeError(`Intl did not return ${type} for ${timeZone}`);
    return Number(part.value);
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/**
 * Coerce a stored timezone to one `Intl` will accept.
 *
 * Falls back to UTC rather than throwing, following `resolveLocale`: `profiles.timezone` can hold
 * anything a hand-edited row or an older client put there, and a bad value must not turn every
 * request into a 500. The rollup is wrong for that user until they fix their setting, which is a far
 * better failure than the nightly job dying for everyone in the same batch.
 */
export function resolveTimeZone(candidate: string | null | undefined): string {
  if (!candidate) return "UTC";
  try {
    formatterFor(candidate);
    return candidate;
  } catch {
    return "UTC";
  }
}

/** The date it is in `timeZone` at `instant`. */
export function localDay(instant: Date, timeZone: string): IsoDate {
  const { year, month, day } = wallClockAt(instant, timeZone);
  return toIsoDate(year, month, day);
}

/** The hour of the day, 0–23, in `timeZone` at `instant`. Drives "is it time to nudge yet?". */
export function localHour(instant: Date, timeZone: string): number {
  return wallClockAt(instant, timeZone).hour;
}

function toIsoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parse(date: IsoDate): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Not an ISO date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * A date as a UTC instant at midnight — the internal representation for arithmetic only.
 *
 * UTC has no daylight saving and no fractional-hour surprises, so adding days to it is exact. This
 * value is never returned: converting a date to a real instant needs a timezone, and that is
 * `dayBounds`.
 */
function toUtcMidnight(date: IsoDate): number {
  const { year, month, day } = parse(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMidnight(ms: number): IsoDate {
  const d = new Date(ms);
  return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const DAY_MS = 86_400_000;

/** Whether a string is a well-formed and real calendar date. Rejects `2026-02-30`. */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  // Round-tripping catches the dates that match the shape but do not exist: Date.UTC rolls
  // 2026-02-30 forward to March 2nd, which no longer formats back to the input.
  return fromUtcMidnight(toUtcMidnight(value)) === value;
}

/** The date `days` after `date`. Negative goes back. */
export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMidnight(toUtcMidnight(date) + days * DAY_MS);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function calendarDaysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / DAY_MS);
}

/** 0 = Sunday, matching `Profile.weekStartsOn` and `Date.getUTCDay`. */
export function dayOfWeek(date: IsoDate): number {
  return new Date(toUtcMidnight(date)).getUTCDay();
}

/**
 * The first day of the week `date` falls in.
 *
 * `weekStartsOn` comes from the profile, never from the locale at render time (FR-L5) — the weekly
 * plan and every "this week" rollup have to agree with each other permanently, and a user switching
 * their interface language must not silently re-bucket last quarter.
 */
export function startOfWeek(date: IsoDate, weekStartsOn: WeekStart): IsoDate {
  const shift = (dayOfWeek(date) - weekStartsOn + 7) % 7;
  return addDays(date, -shift);
}

/** The seven dates of the week beginning at `weekStart`, in order. */
export function weekDays(weekStart: IsoDate): readonly IsoDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Every date from `from` to `to` inclusive. Empty when `to` precedes `from`. */
export function eachDay(from: IsoDate, to: IsoDate): readonly IsoDate[] {
  const span = calendarDaysBetween(from, to);
  if (span < 0) return [];
  return Array.from({ length: span + 1 }, (_, i) => addDays(from, i));
}

/**
 * The instant a local day begins in `timeZone`, and the instant the next one does.
 *
 * `[start, end)` — half-open, because a session that starts exactly at midnight belongs to the day
 * beginning, not to the one ending, and a closed range would count it twice.
 *
 * **Defined as a search, not as an offset calculation, and that is the point.** The obvious
 * implementation — read the zone's offset near midnight, subtract it — is subtly wrong wherever a
 * daylight-saving transition happens *at* midnight, which is how Brazil and Chile ran theirs. Local
 * 00:00 simply does not occur on those days, the offset arithmetic converges on an instant that is
 * still the previous evening, and `dayBounds` and `localDay` then disagree about which day a session
 * belongs to. Bisecting for "the first instant whose local date is this one" has no such case: it
 * asks the question the rollup actually needs answered, and on a gap day it returns the first
 * instant that day exists — 01:00, because there was no 00:00.
 *
 * ISO dates compare lexicographically in calendar order, which is what makes the comparison legal.
 */
export function dayBounds(date: IsoDate, timeZone: string): { start: Date; end: Date } {
  return {
    start: startOfDayInstant(date, timeZone),
    end: startOfDayInstant(addDays(date, 1), timeZone),
  };
}

/**
 * ±26 hours brackets the answer for every zone Intl knows: offsets run from −12:00 to +14:00, so at
 * 26 hours before UTC midnight the local clock reads at worst noon the previous day, and 26 hours
 * after it reads at worst 14:00 the same day. The invariant the loop maintains is therefore true at
 * entry: `localDay(lo) < date <= localDay(hi)`.
 */
const SEARCH_WINDOW_MS = 26 * 60 * 60 * 1000;

function startOfDayInstant(date: IsoDate, timeZone: string): Date {
  const target = toUtcMidnight(date);
  let lo = target - SEARCH_WINDOW_MS;
  let hi = target + SEARCH_WINDOW_MS;

  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (localDay(new Date(mid), timeZone) < date) lo = mid;
    else hi = mid;
  }

  return new Date(hi);
}

/**
 * Active days in the last `window` days ending at `through`.
 *
 * The figure that stands beside the activity grid instead of a streak (FR-N5, §3.9). It degrades
 * gracefully, recovers naturally, and cannot be broken by one bad week — which is the whole point:
 * a counter that resets to zero is a punishment, and punishment corrupts the data this product
 * exists to collect.
 */
export function activeDaysIn(active: Iterable<IsoDate>, through: IsoDate, window: number): number {
  const from = addDays(through, -(window - 1));
  let count = 0;
  const seen = new Set<IsoDate>();
  for (const day of active) {
    if (seen.has(day)) continue;
    if (calendarDaysBetween(from, day) >= 0 && calendarDaysBetween(day, through) >= 0) {
      seen.add(day);
      count += 1;
    }
  }
  return count;
}
