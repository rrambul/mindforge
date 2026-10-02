import type {
  DeadlineRow,
  ExamAttemptFact,
  ExamGrading,
  LessonDepth,
  LessonOutcome,
  LessonStatus,
  Strain,
} from "@mindforge/core";

export const CURRICULUM_READER = Symbol("CurriculumReader");

/** One module of a mission's curriculum, as stored. */
export interface TrackRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly outcome: string | null;
  readonly position: number;
  readonly status: string;
  /** Names, in reading order — what the module is built on (FR-K1). */
  readonly prerequisites: readonly string[];
}

/** One lesson, planned or written, with its prerequisites already collected. */
export interface LessonRow {
  readonly id: string;
  readonly trackId: string | null;
  readonly slug: string;
  readonly title: string;
  readonly intent: string | null;
  readonly status: LessonStatus;
  readonly difficulty: number | null;
  readonly depth: LessonDepth | null;
  readonly position: number | null;
  readonly seq: number | null;
  readonly completedAt: Date | null;
  readonly outcome: LessonOutcome | null;
  readonly prerequisiteIds: readonly string[];
  /** How it landed (FR-D1), judged by `judgeLessons` from the same snapshot. */
  readonly strain: Strain;
  /** What the lesson file says it changed about the plan (FR-D4). */
  readonly adjustment: {
    readonly kind: "bridge" | "harder";
    readonly reason: string | null;
    readonly bridgeForSlug: string | null;
  } | null;
}

/** One item of an exam, with every attempt at it (FR-E6). */
export interface ExamItemRow {
  readonly key: string;
  readonly covers: readonly string[];
  readonly grading: ExamGrading;
  readonly attempts: readonly ExamAttemptFact[];
}

/**
 * An exam file, read apart from the lessons (FR-E2): it is in none of their counts,
 * and every derivation below would otherwise have to remember to skip it.
 */
export interface ExamRow {
  readonly id: string;
  readonly trackId: string | null;
  readonly title: string;
  readonly seq: number;
  readonly items: readonly ExamItemRow[];
}

/**
 * What the schedule is estimated from (FR-U1): both measured, neither defaulted.
 *
 * `lessonMinutes` is one entry per finished lesson the learner has, across every
 * mission — how long *they* take over a lesson is about them, not about this
 * subject. `recentMinutes` is this mission's focus time since `windowStart`.
 */
export interface PaceRows {
  readonly lessonMinutes: readonly number[];
  readonly recentMinutes: number;
}

export interface CurriculumRows {
  readonly tracks: readonly TrackRow[];
  readonly lessons: readonly LessonRow[];
  readonly exams: readonly ExamRow[];
  /** Every commitment ever made, by track. Append-only, so the history is all here. */
  readonly deadlines: ReadonlyMap<string, readonly DeadlineRow[]>;
  readonly pace: PaceRows;
}

/**
 * A mission's curriculum, read whole (FR-K5).
 *
 * **Whole, not per module.** Every derived state on this screen — locked, fundamental,
 * what is next — reads edges that cross module boundaries (FR-K2), so a reader that
 * paged by module would answer "unblocked" for a lesson waiting on one it had not
 * loaded. The unit is the mission, and the screen renders all of it.
 *
 * Returns null when the mission does not exist or is not this user's, which the
 * controller turns into a 404 — the same answer to both, because "it exists but is
 * not yours" is itself something to leak.
 */
export interface CurriculumReader {
  /**
   * `paceSince` is the first instant of the pace window — the start of the learner's
   * local day 27 days ago — resolved by the caller, which knows their timezone.
   */
  read(userId: string, missionId: string, paceSince: Date): Promise<CurriculumRows | null>;
}
