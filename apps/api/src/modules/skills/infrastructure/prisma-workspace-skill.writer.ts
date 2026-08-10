import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type {
  WorkspaceSkillFields,
  WorkspaceSkillWriter,
} from "../domain/workspace-skill.writer.js";

/**
 * The two columns `CURRICULUM.md` represents, written by name.
 *
 * Every statement lists its columns explicitly rather than spreading an object,
 * so adding a field to `WorkspaceSkillFields` is a change somebody has to make
 * here too. That is deliberate: `score`, `band` and `perceived_level` are one
 * careless spread away, and the cost of that mistake is not a wrong number on a
 * screen — it is the calibration gap silently measuring a model's guess against
 * itself.
 */
@Injectable()
export class PrismaWorkspaceSkillWriter implements WorkspaceSkillWriter {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  async existingBySlug(userId: string): Promise<ReadonlyMap<string, string>> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<{ id: string; slug: string }[]>(`select id, slug from skills`),
    );

    return new Map(rows.map((row) => [row.slug, row.id]));
  }

  async createFromWorkspace(userId: string, fields: WorkspaceSkillFields): Promise<string> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(
        // `band` is left to the column default, which is `aware` — the honest
        // value for a skill nobody has demonstrated anything about. `score` and
        // `score_std_dev` stay null, which means *unproven*, and is a different
        // and truer claim than zero (non-negotiable 10).
        `insert into skills (id, user_id, name, slug)
         values (gen_random_uuid(), $1::uuid, $2, $3)
         on conflict (user_id, slug) do update set name = excluded.name
         returning id`,
        userId,
        fields.name,
        fields.slug,
      ),
    );

    return rows[0]!.id;
  }

  async renameFromWorkspace(userId: string, skillId: string, name: string): Promise<void> {
    await this.db.run(userId, (tx) =>
      tx.$executeRawUnsafe(`update skills set name = $2 where id = $1::uuid`, skillId, name),
    );
  }
}
