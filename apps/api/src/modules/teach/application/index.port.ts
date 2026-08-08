export const WORKSPACE_INDEX_REPOSITORY = Symbol("WorkspaceIndexRepository");

export interface IndexedLesson {
  readonly missionId: string;
  readonly seq: number;
  readonly slug: string;
  readonly title: string;
  readonly storagePath: string;
  readonly contentHash: string;
}

export interface IndexedReferenceDoc {
  readonly missionId: string;
  readonly slug: string;
  readonly title: string;
  readonly storagePath: string;
  readonly contentHash: string;
}

export interface IndexedRecord {
  readonly missionId: string;
  readonly seq: number;
  readonly title: string;
  readonly whatLearned: string;
  readonly evidence: string | null;
  readonly keyInsight: string | null;
  readonly struggles: string | null;
  readonly next: string | null;
  readonly storagePath: string;
  readonly contentHash: string;
  /** Resolved in the learner's timezone by the caller, never server-local. */
  readonly recordedAt: Date;
  /** The `NNNN` this record replaces, if one was inferred. */
  readonly supersedesSeq: number | null;
}

/**
 * The three tables the teach module owns outright.
 *
 * `missions` and `resources` are absent on purpose: they belong to other modules,
 * and §2.1 decision 2 says whoever owns the table owns the write. The reindexer
 * routes those through their own use cases.
 */
export interface WorkspaceIndexRepository {
  /** Upsert on `(mission_id, seq)`. */
  saveLessons(userId: string, lessons: readonly IndexedLesson[]): Promise<void>;

  /** Upsert on `(mission_id, storage_path)` — reference docs carry no sequence. */
  saveReferenceDocs(userId: string, docs: readonly IndexedReferenceDoc[]): Promise<void>;

  /**
   * Upsert on `(mission_id, seq)`, resolving `supersedes_seq` to a row id.
   *
   * Resolved here rather than in the caller because it is a lookup against rows
   * that may have been written in the same pass — a record superseding one the
   * same run created has no id to point at until both exist.
   */
  saveRecords(userId: string, records: readonly IndexedRecord[]): Promise<void>;

  /** Rows for files the workspace no longer has, so a deleted lesson leaves the library. */
  forgetPaths(userId: string, missionId: string, paths: readonly string[]): Promise<void>;
}
