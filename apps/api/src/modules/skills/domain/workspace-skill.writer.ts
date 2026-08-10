export const WORKSPACE_SKILL_WRITER = Symbol("WorkspaceSkillWriter");

/**
 * The two fields `CURRICULUM.md` actually represents, and nothing else.
 *
 * The interface is the guardrail, exactly as it is for `RESOURCES.md`. `score`,
 * `score_std_dev`, `band`, `perceived_level`, `half_life_days` and
 * `last_evidence_at` are not expressible here, so no amount of carelessness in
 * the caller can let a generated curriculum assert how good somebody is at
 * something.
 *
 * That is non-negotiable 3 and the third of the three ideas CLAUDE.md says to
 * preserve: self-report and evidence never touch, and a model's opinion is
 * neither. `skills.score` is derived from `skill_evidence` and `perceived_level`
 * is the learner's own claim — a third writer with an opinion would make the
 * calibration gap (FR-S5) meaningless, because it measures the distance between
 * exactly two things.
 */
export interface WorkspaceSkillFields {
  /**
   * Stable identity, from the file's own `Skill slug` column.
   *
   * Honoured rather than re-derived from the name, for the same reason
   * `tracks.slug` is: the agent rewrites `CURRICULUM.md` wholesale, and a slug
   * that moved when a skill was reworded would split one skill's evidence across
   * two rows — silently, and in the direction of a lower score.
   */
  readonly slug: string;
  readonly name: string;
}

export interface WorkspaceSkillWriter {
  /**
   * Every skill this user has, slug → id.
   *
   * User-scoped rather than mission-scoped, and that is the point: `skills` has
   * `unique (user_id, slug)`, so a curriculum naming a skill the learner already
   * has **adopts** it rather than forking it. You learn a thing once, however
   * many missions want it.
   */
  existingBySlug(userId: string): Promise<ReadonlyMap<string, string>>;

  /** Returns the new skill's id, so the caller can link it to a track. */
  createFromWorkspace(userId: string, fields: WorkspaceSkillFields): Promise<string>;

  /**
   * Update the display name of a skill the curriculum already owns.
   *
   * Name only. A reworded skill is the same skill — that is what the slug is for
   * — and everything else on the row is either derived from evidence or the
   * learner's own.
   */
  renameFromWorkspace(userId: string, skillId: string, name: string): Promise<void>;
}
