import type { IsoDate } from "@mindforge/core";

export const DEADLINE_WRITER = Symbol("DeadlineWriter");

/**
 * The one write the curriculum module makes (FR-U2).
 *
 * Append, and nothing else: `module_deadlines` has no UPDATE policy, and this port
 * has no method that could imitate one. Moving a deadline is another append, which
 * is what lets the screen say how many times it moved.
 *
 * `userId` first, always (non-negotiable 1). RLS also checks the module is the
 * learner's, so a track id from another account is refused by the database even if
 * a caller forgot to look.
 */
export interface DeadlineWriter {
  append(userId: string, trackId: string, dueOn: IsoDate): Promise<void>;
}
