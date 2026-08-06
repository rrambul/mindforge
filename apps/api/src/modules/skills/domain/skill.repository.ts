import type { PrereqEdge } from "@mindforge/core";
import type { Skill } from "./skill.js";

export const SKILL_REPOSITORY = Symbol("SkillRepository");

export interface SkillFilter {
  readonly limit?: number | undefined;
}

/**
 * Edges are loaded and written separately from skills, deliberately.
 *
 * A cycle check needs the **whole graph**, not one skill's neighbours — the transitive case is the one
 * that matters — so a repository that only handed back a skill with its direct prerequisites would
 * make the check impossible to write correctly.
 */
export interface SkillRepository {
  findById(userId: string, id: string): Promise<Skill | null>;
  findBySlug(userId: string, slug: string): Promise<Skill | null>;
  list(userId: string, filter: SkillFilter): Promise<Skill[]>;
  save(userId: string, skill: Skill): Promise<void>;
  delete(userId: string, id: string): Promise<void>;

  /** Every edge this user has. The cycle check reads all of them. */
  edges(userId: string): Promise<PrereqEdge[]>;
  addEdge(userId: string, edge: PrereqEdge): Promise<void>;
  removeEdge(userId: string, edge: PrereqEdge): Promise<void>;
}
