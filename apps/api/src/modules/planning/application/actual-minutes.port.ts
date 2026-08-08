import type { ActualMinutes } from "@mindforge/core";

export const ACTUAL_MINUTES = Symbol("ActualMinutes");

/** A half-open instant range, `[from, to)`, as `dayBounds` produces it. */
export interface MinutesWindow {
  readonly from: Date;
  readonly to: Date;
}

/**
 * What you actually did, in minutes, grouped by the subject you did it against.
 *
 * A port rather than a method on `WeeklyPlanRepository`, because the source is `focus_sessions` —
 * another module's table. Same shape as the goals module's `GoalEvidenceReader`, which reaches across
 * the same boundary for the same reason: the plan module owns the *question*, and the adapter owns
 * the knowledge that a session's duration is `ended_at - started_at` rather than a column.
 *
 * The window is instants, not dates, and the caller derives it from the user's timezone with
 * `dayBounds`. That keeps §5.2's "every day and week derives from the user's timezone" a decision
 * made once in the use case rather than a `AT TIME ZONE` buried in SQL.
 */
export interface ActualMinutesReader {
  /** Finished sessions that *started* within the window, summed per subject. */
  read(userId: string, window: MinutesWindow): Promise<ActualMinutes[]>;
}
