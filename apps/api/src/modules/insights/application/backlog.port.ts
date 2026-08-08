export const BACKLOG_READER = Symbol("BacklogReader");

/**
 * One resource, plus the instant a focus session last touched it.
 *
 * Instants rather than days: bucketing into the caller's timezone is a decision the application
 * layer makes once, from `RequestContext`, and a repository that did it would need the timezone
 * threaded into every query for no benefit.
 *
 * `finishedAt` is the *only* date on a resolution. Abandoning sets no timestamp — see the note on
 * `GetBacklogHealth`, which is where that gap is answered for.
 */
export interface BacklogRow {
  readonly id: string;
  readonly status: string;
  readonly addedAt: Date;
  readonly finishedAt: Date | null;
  readonly abandonReason: string | null;
  /** The most recent `focus_sessions.started_at` referencing it, or null if never touched. */
  readonly lastTouchedAt: Date | null;
}

export interface BacklogReader {
  /**
   * Every resource with its last touch, in one round trip.
   *
   * The whole library rather than the window, because `backlogHealth` measures the age of the
   * oldest open item from the day it was added however long ago that was — clipping to the window
   * would hide precisely the item worth seeing.
   */
  listWithLastTouch(userId: string): Promise<BacklogRow[]>;
}
