/**
 * A deadline the learner committed to, and how it stands (FR-U2, FR-U3,
 * `PLAN-EXAMS.md`).
 *
 * **A deadline is a commitment, not a derived number.** It is stored, append-only
 * (`module_deadlines`), and this file only reads it. A date that quietly tracked
 * the projection would be a forecast wearing a deadline's name, and a forecast is
 * never missed.
 *
 * **Moving it is visible.** The current date is the newest row; the first row is
 * what was originally committed; the number of rows after it is how many times it
 * moved. All three are returned together so no screen can show the current date
 * without being able to show the history behind it (non-negotiable 10: no hidden
 * nothing-happened weeks, and no quietly kept promises either).
 *
 * Every comparison is between calendar days in the learner's timezone, which the
 * caller has already resolved (`localDay`). A deadline is a day, not an instant.
 */

import { calendarDaysBetween, type IsoDate } from "../time/calendar.js";

export interface DeadlineRow {
  readonly dueOn: IsoDate;
  readonly createdAt: Date;
}

export interface Deadline {
  /** The date in force: the newest commitment. */
  readonly dueOn: IsoDate;
  /** The date first committed to. Equal to `dueOn` when it never moved. */
  readonly firstDueOn: IsoDate;
  /** How many times it was moved after the first commitment. */
  readonly moves: number;
  readonly committedAt: Date;
}

/** The deadline in force, or null when none was ever committed. */
export function currentDeadline(rows: readonly DeadlineRow[]): Deadline | null {
  if (rows.length === 0) return null;

  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;

  return {
    dueOn: last.dueOn,
    firstDueOn: first.dueOn,
    moves: ordered.length - 1,
    committedAt: last.createdAt,
  };
}

export type DeadlineStatus =
  /** Finished on or before the date. */
  | { readonly kind: "met"; readonly daysEarly: number }
  /** Finished after the date. Said once, plainly, with how late. */
  | { readonly kind: "missed"; readonly daysLate: number }
  /** Not finished, and the date has passed. */
  | { readonly kind: "overdue"; readonly daysOver: number }
  | { readonly kind: "due-today" }
  /** The projection lands on or before the date. */
  | { readonly kind: "on-track"; readonly daysLeft: number }
  /** The projection lands after the date, by `daysBehind`. */
  | { readonly kind: "behind"; readonly daysLeft: number; readonly daysBehind: number }
  /** There is a date and no projection to compare it with. Not on track, not behind: unknown. */
  | { readonly kind: "no-projection"; readonly daysLeft: number };

export function deadlineStatus(input: {
  readonly dueOn: IsoDate;
  readonly today: IsoDate;
  /** The local day the module was finished (`moduleFinishedAt`), or null. */
  readonly finishedOn: IsoDate | null;
  /** The projected exam day, or null when there is no projection. */
  readonly projectedOn: IsoDate | null;
}): DeadlineStatus {
  const { dueOn, today, finishedOn, projectedOn } = input;

  if (finishedOn !== null) {
    const late = calendarDaysBetween(dueOn, finishedOn);
    return late > 0
      ? { kind: "missed", daysLate: late }
      : { kind: "met", daysEarly: calendarDaysBetween(finishedOn, dueOn) };
  }

  const daysLeft = calendarDaysBetween(today, dueOn);
  if (daysLeft < 0) return { kind: "overdue", daysOver: -daysLeft };
  if (daysLeft === 0) return { kind: "due-today" };
  if (projectedOn === null) return { kind: "no-projection", daysLeft };

  const behind = calendarDaysBetween(dueOn, projectedOn);
  return behind > 0
    ? { kind: "behind", daysLeft, daysBehind: behind }
    : { kind: "on-track", daysLeft };
}
