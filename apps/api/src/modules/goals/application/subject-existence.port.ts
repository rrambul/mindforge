export const SUBJECT_EXISTENCE = Symbol("SubjectExistence");

/**
 * Whether a target's subject is really there, and what a skill currently scores.
 *
 * Narrow on purpose: a use case that took the resource, skill, and mission repositories to answer
 * "does this exist" would import three modules to ask one question, and the boundary rules would be
 * right to object.
 */
export interface SubjectExistenceReader {
  exists(userId: string, subject: "resource" | "skill" | "mission", id: string): Promise<boolean>;
  /** Null when unproven, which is not the same as zero — see `bandFor`. */
  skillScore(userId: string, skillId: string): Promise<number | null>;
}
