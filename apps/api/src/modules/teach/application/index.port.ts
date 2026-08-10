export const WORKSPACE_INDEX_REPOSITORY = Symbol("WorkspaceIndexRepository");

export interface IndexedLesson {
  readonly missionId: string;
  readonly seq: number;
  readonly slug: string;
  readonly title: string;
  readonly storagePath: string;
  readonly contentHash: string;
  /**
   * The module this lesson declared, already resolved to a row id.
   *
   * Null both when the lesson declared no track and when it named one this
   * mission's curriculum does not have. The caller distinguishes those two with a
   * warning; the repository cannot, and must not invent a module either way.
   */
  readonly trackId: string | null;
  /**
   * The plan entry this file claims, from `<meta name="mindforge:lesson">`.
   *
   * Null when the lesson claims none — an off-plan lesson, or one written before
   * the mission had a plan. When it is set and a planned row has that slug, the
   * two are the same row and the write fills it in rather than adding a second.
   */
  readonly planSlug: string | null;
}

/**
 * One track from `CURRICULUM.md`, with its references already resolved.
 *
 * Prerequisites stay as slugs because they point at rows this same call creates —
 * the repository resolves them after every track exists, for the same reason
 * `saveRecords` needs two passes over supersession.
 */
export interface IndexedTrack {
  readonly slug: string;
  readonly name: string;
  readonly outcome: string | null;
  readonly position: number;
  readonly prerequisiteSlugs: readonly string[];
}

/**
 * One row of a `## Module:` table: a lesson planned before it exists (FR-K2).
 *
 * `trackId` is not nullable here, unlike on a written lesson. A planned lesson
 * comes from a module section and a module section is a track — there is nowhere
 * for an unfiled one to have come from.
 */
export interface IndexedPlannedLesson {
  readonly slug: string;
  readonly title: string;
  readonly intent: string | null;
  readonly difficulty: number | null;
  readonly depth: string | null;
  readonly position: number;
  readonly trackId: string;
  /**
   * Slugs, resolved by the repository once every lesson in the plan exists —
   * the same two-pass reason `saveTracks` and `saveRecords` both have.
   */
  readonly prerequisiteSlugs: readonly string[];
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
 * The tables the teach module owns outright.
 *
 * `missions` is absent on purpose: it belongs to its own module, and §2.1
 * decision 2 says whoever owns the table owns the write — the reindexer routes
 * it through `UpdateMission`. `tracks` is here because nothing but a workspace
 * has ever created one.
 */
export interface WorkspaceIndexRepository {
  /**
   * Upsert `tracks` on `(mission_id, slug)`, then rebuild their edges.
   *
   * **Upsert and never delete.** The agent rewrites `CURRICULUM.md` wholesale, so
   * a track missing from one regeneration is far more likely to be a model
   * shortening its output than a decision to abandon a module — and deleting it
   * would take a module of finished lessons with it. A vanished track is marked
   * `dropped`; if it comes back, it is un-dropped.
   *
   * Returns declared slug → row id, so lessons can resolve their `<meta>` tag.
   */
  saveTracks(
    userId: string,
    missionId: string,
    tracks: readonly IndexedTrack[],
  ): Promise<ReadonlyMap<string, string>>;

  /** Every track slug this mission has, for resolving lessons when the file is absent. */
  trackIdsBySlug(userId: string, missionId: string): Promise<ReadonlyMap<string, string>>;

  /**
   * The `## Module:` tables → planned `lessons` and their `lesson_edges`.
   *
   * **The file owns what a lesson is; the plan owns why it is there.** A slug
   * that already has a file behind it keeps its title, its module and its
   * content — the plan may only revise that row's intent, difficulty, depth and
   * position. Anything else would let a regenerated curriculum rename a lesson
   * the learner has already read.
   *
   * **Pruning is per module, not per mission.** A planned row whose slug has
   * gone from a module that *was* in this parse is deleted: there is no file
   * behind it, so nothing is lost, and keeping it would inflate the module's
   * denominator with a lesson the plan has abandoned. A module absent from the
   * parse entirely is left alone — a run that stopped halfway through writing
   * the file has not decided anything about the modules it never reached.
   */
  savePlannedLessons(
    userId: string,
    missionId: string,
    lessons: readonly IndexedPlannedLesson[],
  ): Promise<void>;

  /**
   * Upsert on `(mission_id, seq)` — except when the lesson claims a plan entry.
   *
   * A claimed plan entry *is* this lesson: the row it already has stops being an
   * intention and becomes the file, keeping its id, its intent, its difficulty
   * and every edge pointing at it. Inserting instead would leave the module owing
   * a lesson that has already been taught.
   */
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
