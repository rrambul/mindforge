import type { LessonDepth, LessonOutcome, LessonStatus } from "@mindforge/core";

export const LESSON_REPOSITORY = Symbol("LessonRepository");

/**
 * One lesson, as the reader needs it.
 *
 * Carries `workspaceKey` rather than a ready-made URL: the grant is minted in the
 * application layer from a secret the infrastructure has no business holding, and
 * a repository that returned a signed URL would be a repository that decides how
 * long access lasts.
 */
export interface LessonRecord {
  readonly id: string;
  readonly missionId: string;
  readonly trackId: string | null;
  /** The module's display name, for the reader's chrome. Null off-plan. */
  readonly moduleName: string | null;
  readonly slug: string;
  readonly title: string;
  readonly intent: string | null;
  readonly status: LessonStatus;
  readonly difficulty: number | null;
  readonly depth: LessonDepth | null;
  readonly seq: number | null;
  /** Full Storage path. Null while the lesson is only planned. */
  readonly storagePath: string | null;
  /** The mission's Storage prefix segment. Null before the first teach run. */
  readonly workspaceKey: string | null;
  readonly completedAt: Date | null;
  readonly outcome: LessonOutcome | null;
}

/**
 * `userId` first on every method, always — CLAUDE.md's first non-negotiable
 * expressed in the type system.
 */
export interface LessonRepository {
  findById(userId: string, id: string): Promise<LessonRecord | null>;

  /**
   * Write the completion, or clear it.
   *
   * One method rather than `complete` and `reopen`, because the two write the same
   * two columns and splitting them invites a third caller that sets one without
   * the other — a lesson with an outcome and no `completed_at` is a lesson that is
   * both finished and not.
   */
  setCompletion(
    userId: string,
    id: string,
    completion: { readonly completedAt: Date; readonly outcome: LessonOutcome } | null,
  ): Promise<void>;
}
