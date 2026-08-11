export const MISSION_WORKSPACE_READER = Symbol("MissionWorkspaceReader");

export interface MissionWorkspace {
  readonly missionId: string;
  readonly topic: string;
  readonly status: string;
  /** Null until the first run materialises it. */
  readonly workspaceKey: string | null;
  /**
   * Whether `CURRICULUM.md` has been indexed into modules yet.
   *
   * It decides which agent the next run loads (FR-K1): a mission with no modules
   * needs a plan before it needs a lesson. Inferred rather than chosen by the
   * client, because "which skill runs" is not a decision a browser should be able
   * to make — and a lesson taught against no curriculum is the state M4 exists to
   * remove.
   */
  readonly hasCurriculum: boolean;
}

/**
 * What the teach module needs to know about a mission, without owning it.
 *
 * `missions` belongs to the missions module, and §2.1 decision 2 is that whoever
 * owns the table owns the write. A reader rather than a repository makes that
 * structural: there is no method here that could change a mission, so the only
 * write this module can make to `missions` is the one below — claiming a
 * workspace key, which is a fact about the *workspace* rather than about the
 * mission, and which no other module has any reason to set.
 */
export interface MissionWorkspaceReader {
  find(userId: string, missionId: string): Promise<MissionWorkspace | null>;

  /** Every key this user has already taken, for `deriveWorkspaceKey`. */
  takenKeys(userId: string): Promise<readonly string[]>;

  /**
   * Set `workspace_key`, and only if it is still null.
   *
   * Conditional so that two runs racing on a mission that has never been taught
   * cannot both assign one — the loser reads back the winner's key instead of
   * overwriting it, which would point the two runs at different prefixes and
   * split the learner's history in half. Returns the key that is now stored,
   * whoever wrote it.
   */
  claimWorkspaceKey(userId: string, missionId: string, key: string): Promise<string>;
}
