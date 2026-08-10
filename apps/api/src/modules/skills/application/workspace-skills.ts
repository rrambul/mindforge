import { skillSlug } from "@mindforge/core";
import type { ParsedTrackSkill } from "@mindforge/workspace";
import { Inject, Injectable } from "@nestjs/common";

import {
  WORKSPACE_SKILL_WRITER,
  type WorkspaceSkillWriter,
} from "../domain/workspace-skill.writer.js";

/**
 * `CURRICULUM.md`'s skills → the skill graph.
 *
 * In the skills module rather than in `teach`, because whoever owns the table
 * owns the write (§2.1 decision 2) — and because the two decisions this makes are
 * skills decisions.
 *
 * ### It adopts, it never forks
 *
 * `skills` is unique on `(user_id, slug)`, not on `(mission_id, slug)`. A
 * curriculum for an AWS mission that names `iam-read-policy`, and a second
 * curriculum for a security mission that names it too, are talking about one
 * skill — so the second run links the existing row rather than creating a
 * near-duplicate. That is what makes a score mean something across missions
 * instead of being diluted between two rows that are the same thing.
 *
 * ### It cannot say how good you are
 *
 * `WorkspaceSkillFields` has two fields. Everything else on `skills` is either
 * derived from `skill_evidence` or is the learner's own `perceived_level`, and
 * FR-S5 measures the distance between exactly those two. A generated curriculum
 * with an opinion about either would not be a third data point; it would quietly
 * destroy the only metric this product has for whether you know what you think
 * you know.
 *
 * This deliberately does not go through `CreateSkill`. That use case's job is to
 * protect a human's graph — it rejects a duplicate name with `SkillNameTaken`,
 * because "Rust" typed twice is almost always a mistake — and here a repeated
 * slug is the *normal* case and the correct response is to adopt it. Routing
 * through it would mean adding an upsert mode whose only purpose is to skip the
 * invariant the use case exists for.
 */

export interface CurriculumSkillsInput {
  readonly userId: string;
  readonly skills: readonly ParsedTrackSkill[];
}

export interface CurriculumSkillsResult {
  /**
   * **Every** skill this user has, normalised slug → id — not only the ones this
   * curriculum named.
   *
   * The wider map is what makes lesson `<meta name="mindforge:skill">` tags
   * resolve. A teach run writes a lesson and does not touch `CURRICULUM.md`, so a
   * map built only from the file just parsed would be empty on exactly the runs
   * that produce lessons, and every skill tag would fail to resolve.
   */
  readonly idBySlug: ReadonlyMap<string, string>;
  readonly created: number;
  readonly adopted: number;
}

/**
 * Normalise the file's slug the way the rest of the product forms one.
 *
 * Idempotent for a well-formed slug, and it applies the 80-character cap that
 * `skills.slug` is written against everywhere else. Without it, a curriculum
 * declaring a 200-character slug would produce a row the UI could never generate
 * and could therefore never match.
 */
export function curriculumSkillSlug(declared: string, name: string): string {
  return skillSlug(declared) || skillSlug(name);
}

@Injectable()
export class SyncCurriculumSkills {
  constructor(@Inject(WORKSPACE_SKILL_WRITER) private readonly writer: WorkspaceSkillWriter) {}

  async execute(input: CurriculumSkillsInput): Promise<CurriculumSkillsResult> {
    // One read rather than a lookup per row. A curriculum has tens of skills and
    // the whole graph is a few hundred rows at the very most, inside a run that
    // is already minutes long. It doubles as the returned map: rows created below
    // are added to it, so a second entry declaring the same slug adopts the row
    // this loop just made instead of colliding with it on the unique index.
    const idBySlug = new Map(await this.writer.existingBySlug(input.userId));

    let created = 0;
    let adopted = 0;
    const handled = new Set<string>();

    for (const skill of input.skills) {
      const slug = curriculumSkillSlug(skill.skillSlug, skill.name);
      if (slug === "" || handled.has(slug)) continue;
      handled.add(slug);

      const existingId = idBySlug.get(slug);

      if (existingId === undefined) {
        const id = await this.writer.createFromWorkspace(input.userId, { slug, name: skill.name });
        idBySlug.set(slug, id);
        created += 1;
        continue;
      }

      await this.writer.renameFromWorkspace(input.userId, existingId, skill.name);
      adopted += 1;
    }

    return { idBySlug, created, adopted };
  }

  /**
   * Every skill this user has, for a run that did not rewrite `CURRICULUM.md`.
   *
   * Which is most of them: the teach agent is told the curriculum is an input,
   * so the normal shape of a run is one new lesson and an untouched file.
   */
  allBySlug(userId: string): Promise<ReadonlyMap<string, string>> {
    return this.writer.existingBySlug(userId);
  }
}
