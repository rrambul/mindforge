/**
 * How long a module will take, from how the learner has actually been working
 * (FR-U1, FR-U4, `PLAN-EXAMS.md`).
 *
 * The one implementation, used by the curriculum screen and by the deadline
 * proposal. Derived on read, never stored: the schedule a learner looks at on
 * Friday is computed from Friday's history.
 *
 * Two measured inputs and nothing else:
 *
 * - **Minutes per lesson** — the median of the focus minutes bound to each finished
 *   lesson (FR-F3, FR-F5). A lesson finished with no time bound to it is left out
 *   rather than counted as zero: "no minutes recorded" is not "took no minutes". The
 *   median rather than the mean, because one lesson left open in a tab over lunch
 *   should not move every date on the schedule.
 * - **Daily pace** — focus minutes on this mission over the last 28 local days,
 *   divided by the days in that window. Rest days are included on purpose: a pace
 *   measured only on the days you showed up is the pace of a learner who never
 *   rests, and a schedule built on it is missed by design. **The window starts no
 *   earlier than the mission did** (`paceWindowDays`): days before it existed are
 *   not rest days, and dividing a three-day-old mission's time by 28 put a
 *   one-week exam two months away.
 *
 * **No input, no estimate.** Below `MIN_TIMED_LESSONS` timed lessons, or with no
 * focus time in the window, the answer is unknown with the reason why. A default
 * ("say thirty minutes a lesson") would be a guess presented as a measurement,
 * which is the thing this product exists not to do (non-negotiable 10).
 *
 * **Days round up.** Rounding down would make every projection a day early, and an
 * estimate that is always slightly optimistic is a deadline that is always slightly
 * missed.
 */

import { addDays, calendarDaysBetween, type IsoDate } from "../time/calendar.js";

/** Fewer timed lessons than this and the median is an anecdote. */
export const MIN_TIMED_LESSONS = 3;

/** The pace window, the same 28 days the frequency tracker's active-days figure uses. */
export const PACE_WINDOW_DAYS = 28;

/**
 * How many days the pace is measured over: the last 28, or every day since the
 * mission's first if that is fewer, today included either way. A first day after
 * today (a clock that disagrees with a row) still counts today, never zero days.
 */
export function paceWindowDays(firstDay: IsoDate, today: IsoDate): number {
  return Math.min(PACE_WINDOW_DAYS, Math.max(1, calendarDaysBetween(firstDay, today) + 1));
}

export interface Pace {
  readonly minutesPerLesson: number;
  /** How many finished lessons the median was taken over. */
  readonly timedLessons: number;
  readonly minutesPerDay: number;
  readonly windowDays: number;
}

/** What is missing when there is no pace. Both can be. */
export type PaceGap = "timed-lessons" | "recent-time";

export type PaceResult =
  | { readonly status: "known"; readonly pace: Pace }
  | {
      readonly status: "unknown";
      readonly missing: readonly PaceGap[];
      readonly timedLessons: number;
    };

/**
 * The learner's pace, or what stops it being known.
 *
 * `lessonMinutes` is one entry per finished lesson — exams excluded, they are not
 * lessons (FR-E2) — holding the focus minutes bound to it. Zeros are dropped here
 * rather than by every caller.
 */
export function schedulePace(input: {
  readonly lessonMinutes: readonly number[];
  readonly recentMinutes: number;
  readonly windowDays?: number;
}): PaceResult {
  const windowDays = input.windowDays ?? PACE_WINDOW_DAYS;
  const timed = input.lessonMinutes.filter((minutes) => minutes > 0);

  const missing: PaceGap[] = [];
  if (timed.length < MIN_TIMED_LESSONS) missing.push("timed-lessons");
  if (input.recentMinutes <= 0) missing.push("recent-time");

  if (missing.length > 0) return { status: "unknown", missing, timedLessons: timed.length };

  return {
    status: "known",
    pace: {
      minutesPerLesson: median(timed),
      timedLessons: timed.length,
      minutesPerDay: input.recentMinutes / windowDays,
      windowDays,
    },
  };
}

/** The middle value, or the mean of the two middle ones. Callers guarantee at least one. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** One module's outstanding work, in curriculum order. */
export interface ModuleWork {
  readonly id: string;
  /**
   * A module a regenerated curriculum stopped listing. It is still shown when it
   * holds finished lessons, and it is no longer part of the plan: it takes no time
   * and breaks nothing after it.
   */
  readonly dropped?: boolean;
  /** False for a module with no lessons at all — its size is unknown, not zero. */
  readonly planned: boolean;
  /** Lessons not yet completed. Exams are not lessons and are not in this count. */
  readonly remainingLessons: number;
  /** Whether the module's exam is passed. An unwritten exam is still work to do. */
  readonly examPassed: boolean;
}

export type Projection =
  | { readonly status: "finished" }
  | {
      readonly status: "projected";
      /** Lessons left plus one for the exam, until it is passed. */
      readonly units: number;
      readonly minutes: number;
      /** The day work on this module is projected to begin. */
      readonly startDay: IsoDate;
      /** The day its exam is projected to be sat. */
      readonly examDay: IsoDate;
    }
  | {
      readonly status: "unknown";
      /**
       * `not-planned` — this module has no lessons, so its size is unknown.
       * `after-unplanned` — an earlier module is not planned, so nobody knows when
       * this one starts.
       * `no-pace` — the learner's pace is not known (see the mission's pace result).
       * `dropped` — the curriculum no longer plans this module.
       */
      readonly reason: "not-planned" | "after-unplanned" | "no-pace" | "dropped";
    };

/**
 * The schedule: each module's projected exam day, chained in the order given (FR-U4).
 *
 * Each module starts where the one before it is projected to end, and a finished
 * module takes no time. The chain is kept in fractional days and rounded up only at
 * each module's end, so five half-day modules take three days rather than five.
 *
 * The exam is counted as one more lesson's worth of time until it is passed. It is
 * an estimate of an estimate, and the basis says so; leaving it out would schedule
 * every exam for a day with no time left in it.
 *
 * An unplanned module breaks the chain for everything after it: its length is
 * unknown, so nothing after it has a start date. The modules before it keep theirs.
 */
export function projectSchedule(
  modules: readonly ModuleWork[],
  pace: PaceResult,
  today: IsoDate,
): ReadonlyMap<string, Projection> {
  const projections = new Map<string, Projection>();
  let elapsedDays = 0;
  let broken = false;

  for (const module of modules) {
    const units = module.remainingLessons + (module.examPassed ? 0 : 1);

    if (module.dropped === true) {
      projections.set(module.id, { status: "unknown", reason: "dropped" });
      continue;
    }
    if (module.planned && units === 0) {
      projections.set(module.id, { status: "finished" });
      continue;
    }
    if (!module.planned) {
      projections.set(module.id, { status: "unknown", reason: "not-planned" });
      broken = true;
      continue;
    }
    if (broken) {
      projections.set(module.id, { status: "unknown", reason: "after-unplanned" });
      continue;
    }
    if (pace.status === "unknown") {
      projections.set(module.id, { status: "unknown", reason: "no-pace" });
      continue;
    }

    const minutes = units * pace.pace.minutesPerLesson;
    const startDay = addDays(today, Math.floor(elapsedDays));
    elapsedDays += minutes / pace.pace.minutesPerDay;

    projections.set(module.id, {
      status: "projected",
      units,
      minutes: Math.ceil(minutes),
      startDay,
      examDay: addDays(today, Math.ceil(elapsedDays) - 1),
    });
  }

  return projections;
}

/**
 * One module on its own, starting today — what a deadline is proposed from (FR-U2).
 *
 * Not the schedule's entry for it: the schedule queues the module behind every
 * unfinished one before it, and the learner committing to *this* module is saying
 * they are working on it now.
 */
export function estimateModule(module: ModuleWork, pace: PaceResult, today: IsoDate): Projection {
  return projectSchedule([module], pace, today).get(module.id)!;
}
