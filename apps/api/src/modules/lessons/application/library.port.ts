export const LIBRARY_READER = Symbol("LibraryReader");

/** One `./reference/*.html` — the documents you come back to (FR-T6). */
export interface ReferenceDocRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly storagePath: string;
  readonly updatedAt: Date;
}

/**
 * One `./learning-records/NNNN-*.md`, as the skill's own format writes it.
 *
 * The fields come back separately rather than as rendered Markdown because they
 * are separate questions — what you learned, what proves it, what you struggled
 * with, what is next — and a screen that showed one paragraph would make the
 * struggles as easy to skip as the evidence.
 */
export interface LearningRecordRow {
  readonly id: string;
  readonly seq: number;
  readonly title: string;
  readonly lessonId: string | null;
  /** The lesson's title, so a record can be read without loading the curriculum. */
  readonly lessonTitle: string | null;
  readonly whatLearned: string;
  readonly evidence: string | null;
  readonly keyInsight: string | null;
  readonly struggles: string | null;
  readonly next: string | null;
  readonly recordedAt: Date;
}

export interface MissionLibrary {
  /** The mission's Storage prefix segment. Null before the first teach run. */
  readonly workspaceKey: string | null;
  readonly referenceDocs: readonly ReferenceDocRow[];
}

/**
 * The two browsable collections a workspace produces.
 *
 * Both return null when the mission is not this user's — the same answer as one
 * that does not exist, because "it exists but is not yours" is itself something to
 * leak.
 */
export interface LibraryReader {
  referenceDocs(userId: string, missionId: string): Promise<MissionLibrary | null>;

  /**
   * Records, newest first, optionally narrowed to the lesson they came out of.
   *
   * The filter is what makes a record reachable *from* its lesson (FR-T6) without
   * the reader loading a mission's entire history to find two paragraphs.
   */
  learningRecords(
    userId: string,
    missionId: string,
    lessonId?: string,
  ): Promise<readonly LearningRecordRow[] | null>;
}
