import type { IsoDate } from "@mindforge/core";

/**
 * The one place a calendar date becomes a `@db.Date` value and back.
 *
 * `weekly_plans.week_start` and `weekly_reviews.week_start` are dates, and an `IsoDate` is a date —
 * but the driver's currency in between is a JavaScript `Date`, which is an instant and therefore
 * carries a timezone neither of them has. Every bug in this area is the same bug: a value built at
 * *local* midnight, which is the previous day in UTC for everyone east of Greenwich and formats back
 * a day early for everyone west of it.
 *
 * Pinning both directions to UTC midnight makes the round trip exact. It is two lines and it is in
 * one file precisely because it is two lines: the second copy is where the drift starts.
 */

/** `2026-08-03` → the instant Prisma writes into a `date` column as `2026-08-03`. */
export function toDateColumn(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** A `date` column, as the driver hands it back, → `2026-08-03`. */
export function fromDateColumn(value: Date): IsoDate {
  return value.toISOString().slice(0, 10);
}
