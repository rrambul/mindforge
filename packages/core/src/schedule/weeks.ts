/**
 * The week calendar (FR-B1–B6, `PLAN-WEEKS.md`).
 *
 * A mission planned in weeks has one module per week and five lessons per module.
 * Days 1–5 of a week are its lessons, day 6 is the module's exam, day 7 is rest —
 * counted from the week start in the learner's profile, so Monday to Friday and an
 * exam on Saturday for a week that starts on Monday.
 *
 * **Everything here is derived, never stored** (principle 2). The mission stores two
 * facts, how many weeks and the day the first one starts; every date below is
 * arithmetic over those and the plan's order.
 *
 * **The calendar is fixed** (FR-B4). Nothing here moves a date because the learner
 * fell behind; what changes is the standing — how many lessons due by today are
 * unfinished — and it is stated, never hidden (non-negotiable 10).
 */

import { addDays, calendarDaysBetween, dayOfWeek, type IsoDate } from "../time/calendar.js";

export const LESSONS_PER_WEEK = 5;
/** Day 6, as an offset from the week's first day. */
export const EXAM_DAY_OFFSET = 5;
export const MIN_WEEKS = 1;
export const MAX_WEEKS = 52;
/**
 * How far ahead a mission may start. A year is room for any real plan; beyond it is
 * a year typed wrong, and the calendar cannot be edited after creation.
 */
export const MAX_START_AHEAD_DAYS = 365;

/**
 * The first week start on or after `today`: today itself when it is one.
 *
 * A mission that started mid-week would open with its first days already overdue,
 * so the default start is the next week start, and only a week start is accepted.
 */
export function firstWeekStart(today: IsoDate, weekStartsOn: number): IsoDate {
  return addDays(today, (weekStartsOn - dayOfWeek(today) + 7) % 7);
}

/** Whether `day` is a week start in a profile whose weeks start on `weekStartsOn`. */
export function isWeekStart(day: IsoDate, weekStartsOn: number): boolean {
  return dayOfWeek(day) === weekStartsOn;
}

/** The mission's last day: the rest day of its last week. */
export function missionEndsOn(startsOn: IsoDate, weeks: number): IsoDate {
  return addDays(startsOn, 7 * weeks - 1);
}

export interface Week {
  /** 1-based: week 1 is the first module. */
  readonly index: number;
  readonly startsOn: IsoDate;
  /** Day 6: the module's exam, and its deadline (FR-B3). */
  readonly examOn: IsoDate;
  /** Day 7. */
  readonly endsOn: IsoDate;
}

/** Week `index` (1-based) of a mission that starts on `startsOn`. */
export function weekOf(startsOn: IsoDate, index: number): Week {
  const start = addDays(startsOn, 7 * (index - 1));
  return {
    index,
    startsOn: start,
    examOn: addDays(start, EXAM_DAY_OFFSET),
    endsOn: addDays(start, 6),
  };
}

/**
 * Which week each module gets, for the modules that have none yet (FR-B4).
 *
 * **A module keeps the week it was first given.** Week numbers are pinned on the
 * module's row when the plan is first indexed, and this only ever hands out new
 * ones: to modules with no week, in the plan's order, starting after the highest
 * week already taken. Deriving the week from the plan's order on every read moved
 * every later date by a week whenever a revision dropped or inserted a module, and
 * a calendar that moves is not the fixed calendar the learner planned around.
 *
 * A dropped module keeps its slot — it may hold finished lessons, and its dates
 * were real — and is given none if it never had one.
 */
export function pinWeeks(
  tracks: readonly {
    readonly id: string;
    readonly week: number | null;
    readonly position: number;
    readonly dropped: boolean;
  }[],
): ReadonlyMap<string, number> {
  let next = Math.max(0, ...tracks.map((track) => track.week ?? 0)) + 1;
  const pinned = new Map<string, number>();
  for (const track of [...tracks].sort((a, b) => a.position - b.position)) {
    if (track.week !== null || track.dropped) continue;
    pinned.set(track.id, next);
    next += 1;
  }
  return pinned;
}

/**
 * Each planned lesson's day in its week, 1–5, from the plan's own row order (FR-B3).
 *
 * The plan's order, not the easiest-first order the curriculum screen lists by:
 * the curriculum run is told to order a module's rows so day 1 to day 5 build on
 * each other, and a revised difficulty must not reshuffle a week's dates. A lesson
 * with no row in the plan — taught off-plan, or a bridge — has no day: it is extra
 * work, and counting it would put a sixth lesson on a five-day week.
 *
 * A module planned with more than five lessons — which the reindexer warns about
 * (FR-B2) — puts the extras on day 5 rather than on the exam day: they are still
 * that week's work, and the warning is where the mismatch is said.
 */
export function lessonDays(
  lessons: readonly { readonly id: string; readonly position: number | null }[],
): ReadonlyMap<string, number> {
  const planned = lessons
    .filter((lesson): lesson is { id: string; position: number } => lesson.position !== null)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  return new Map(
    planned.map((lesson, index) => [lesson.id, Math.min(index + 1, LESSONS_PER_WEEK)] as const),
  );
}

/** The date of day `day` (1–5) of a week, clamped to the lesson days. */
export function lessonDueOn(week: Week, day: number): IsoDate {
  return addDays(week.startsOn, Math.min(Math.max(day, 1), LESSONS_PER_WEEK) - 1);
}

/** As much of a module as its standing needs. */
export interface WeekProgress {
  readonly week: Week;
  /** Every lesson in the module: its day (null off-plan) and whether it is done. */
  readonly lessons: readonly { readonly day: number | null; readonly completed: boolean }[];
  /** The local day the module was finished (`moduleFinishedAt`), or null. */
  readonly finishedOn: IsoDate | null;
}

export type WeekStanding =
  /**
   * No lesson is planned for this week yet — a curriculum run that has not reached
   * it. Unknown, so never "on track" and never "done" (non-negotiable 10).
   */
  | { readonly kind: "not-planned" }
  /** The week has not started. */
  | { readonly kind: "upcoming"; readonly startsInDays: number }
  /**
   * Today is inside the week, and the module is not finished. `behind` counts the
   * unfinished lessons of **earlier** days only; today's lesson is `dueToday`, not
   * late — at 8am on day 1 nobody is behind.
   */
  | {
      readonly kind: "in-progress";
      /** The week's planned lessons: the denominator, never assumed to be five. */
      readonly total: number;
      readonly completed: number;
      readonly behind: number;
      readonly dueToday: number;
      readonly examToday: boolean;
    }
  /** Finished: lessons done and exam passed. `daysLate` 0 is on time. */
  | { readonly kind: "finished"; readonly daysLate: number }
  /** The week is over and the module is not finished. */
  | {
      readonly kind: "overdue";
      readonly daysOver: number;
      readonly lessonsLeft: number;
      readonly total: number;
    };

/**
 * Where a week stands today (FR-B5).
 *
 * Only the week's planned lessons count — the ones with a day. "Late" is measured
 * against the exam day, the module's deadline; "overdue" starts the day after the
 * week ends, because the rest day is still the week. A module finished early is
 * simply finished: there is no bonus for early, as there is no penalty beyond the
 * count for late.
 */
export function weekStanding(progress: WeekProgress, today: IsoDate): WeekStanding {
  const { week, finishedOn } = progress;

  if (finishedOn !== null) {
    return {
      kind: "finished",
      daysLate: Math.max(0, calendarDaysBetween(week.examOn, finishedOn)),
    };
  }

  // Days come from the plan; the count is every lesson the module has. A bridge
  // has no day, so it is never behind or due, but it is work in this week, and
  // leaving it out made "2 of 5" here sit under "2 of 6" in the module's bar.
  const dated = progress.lessons.filter(
    (lesson): lesson is { day: number; completed: boolean } => lesson.day !== null,
  );
  if (dated.length === 0) return { kind: "not-planned" };

  const untilStart = calendarDaysBetween(today, week.startsOn);
  if (untilStart > 0) return { kind: "upcoming", startsInDays: untilStart };

  const total = progress.lessons.length;
  const completed = progress.lessons.filter((lesson) => lesson.completed).length;
  const overBy = calendarDaysBetween(week.endsOn, today);
  if (overBy > 0) {
    return {
      kind: "overdue",
      daysOver: overBy,
      lessonsLeft: total - completed,
      total,
    };
  }

  const open = dated.filter((lesson) => !lesson.completed);
  const dayOf = (lesson: { day: number }) =>
    calendarDaysBetween(lessonDueOn(week, lesson.day), today);
  return {
    kind: "in-progress",
    total,
    completed,
    behind: open.filter((lesson) => dayOf(lesson) > 0).length,
    dueToday: open.filter((lesson) => dayOf(lesson) === 0).length,
    examToday: today === week.examOn,
  };
}

/**
 * Whether a plan has the shape a weekly mission promises (FR-B2): one module per
 * week, five lessons in each. Null when it does; otherwise what is off, so the run
 * can say it rather than the screen quietly doing something odd with week 7 of 6.
 */
export function weeklyShapeGaps(
  weeks: number,
  lessonsPerModule: readonly number[],
): { readonly modules: number; readonly offModules: readonly number[] } | null {
  const offModules = lessonsPerModule
    .map((count, index) => (count === LESSONS_PER_WEEK ? null : index + 1))
    .filter((week): week is number => week !== null);
  if (lessonsPerModule.length === weeks && offModules.length === 0) return null;
  return { modules: lessonsPerModule.length, offModules };
}
