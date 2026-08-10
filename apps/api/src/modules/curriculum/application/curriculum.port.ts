import type { LessonDepth, LessonStatus } from "@mindforge/core";

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
  readonly outcome: string | null;
  readonly prerequisiteIds: readonly string[];
}

export interface CurriculumRows {
  readonly tracks: readonly TrackRow[];
  readonly lessons: readonly LessonRow[];
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
  read(userId: string, missionId: string): Promise<CurriculumRows | null>;
}
