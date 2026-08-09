import type { MemoryKind } from "@mindforge/workspace";

export const LEARNER_MEMORY_REPOSITORY = Symbol("LearnerMemoryRepository");

export interface IndexedMemory {
  readonly slug: string;
  readonly kind: MemoryKind;
  /** The file's one-line summary. What relevance selection loads once this grows. */
  readonly summary: string;
  readonly storagePath: string;
  readonly contentHash: string;
}

export interface LearnerMemoryView {
  readonly id: string;
  readonly slug: string;
  readonly kind: MemoryKind;
  readonly summary: string;
  /** `agent` or `user`. The agent writes it; you own it (§7.6). */
  readonly writtenBy: string;
  /** Set when the learner has read it and agreed. Null is "not reviewed", not "wrong". */
  readonly confirmedAt: Date | null;
  /** The memory that replaced this one, if any. */
  readonly supersededBySlug: string | null;
  readonly updatedAt: Date;
}

export interface LearnerMemoryRepository {
  /**
   * Upsert what a run wrote.
   *
   * **Never touches `written_by` or `confirmed_at`.** A run must not be able to
   * mark its own inference as user-confirmed, and a memory the learner typed
   * themselves stays theirs even if the agent later rewrites the file.
   */
  saveFromAgent(userId: string, memories: readonly IndexedMemory[]): Promise<void>;

  /** Point `supersededSlug` forward at `replacementSlug`. False when either is absent. */
  markSuperseded(userId: string, supersededSlug: string, replacementSlug: string): Promise<boolean>;

  list(userId: string): Promise<readonly LearnerMemoryView[]>;

  /** The learner agreeing with an inference. Idempotent. */
  confirm(userId: string, id: string): Promise<LearnerMemoryView | null>;

  /**
   * Remove a memory the learner disagrees with.
   *
   * The row and the file both. §7.6 says the agent supersedes rather than
   * deletes; the learner is the one who gets to delete outright, because a wrong
   * entry is replayed into every future run on every mission.
   */
  forget(userId: string, id: string): Promise<{ readonly storagePath: string } | null>;
}
