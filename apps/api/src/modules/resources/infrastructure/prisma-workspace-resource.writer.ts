import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { normalizeTitle, normalizeUrl } from "../application/workspace-resources.js";
import type {
  ExistingResourceKeys,
  WorkspaceRejection,
  WorkspaceResourceFields,
  WorkspaceResourceWriter,
} from "../domain/workspace-resource.writer.js";

/**
 * The four columns `RESOURCES.md` represents, written by name.
 *
 * Every statement here lists its columns explicitly rather than spreading an
 * object, so that adding a field to `WorkspaceResourceFields` is a change
 * somebody has to make here too. That is deliberate: the columns this must never
 * touch — `status`, `progress`, `finished_at`, `abandon_reason` — are one careless
 * spread away, and the cost of that mistake is a library that resets itself on
 * every run.
 */
@Injectable()
export class PrismaWorkspaceResourceWriter implements WorkspaceResourceWriter {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  async existingKeys(userId: string): Promise<ExistingResourceKeys> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<{ id: string; title: string; url: string | null }[]>(
        `select id, title, url from resources`,
      ),
    );

    const byUrl = new Map<string, string>();
    const byTitle = new Map<string, string>();

    for (const row of rows) {
      const url = normalizeUrl(row.url);
      // First wins on both. Two rows already sharing a key is pre-existing
      // duplication, and picking the newer one would move the agent's writes
      // between them run to run.
      if (url !== null && !byUrl.has(url)) byUrl.set(url, row.id);
      const title = normalizeTitle(row.title);
      if (!byTitle.has(title)) byTitle.set(title, row.id);
    }

    return { byUrl, byTitle };
  }

  async createFromWorkspace(
    userId: string,
    missionId: string,
    fields: WorkspaceResourceFields,
  ): Promise<void> {
    await this.db.run(userId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        // `status` is left to the column default, which is `inbox` — correct for
        // something the agent found and nobody has started. It is set here, once,
        // at creation, and never touched again by this path.
        `insert into resources (id, user_id, type, title, url, trust, status, added_at)
         values (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, 'inbox', now())
         returning id`,
        userId,
        fields.type,
        fields.title,
        fields.url,
        fields.trust,
      );

      await linkToMission(tx, userId, rows[0]!.id, missionId);
    });
  }

  async updateFromWorkspace(
    userId: string,
    missionId: string,
    resourceId: string,
    fields: WorkspaceResourceFields,
  ): Promise<void> {
    await this.db.run(userId, async (tx) => {
      await tx.$executeRawUnsafe(
        // Four columns. Not `status`, not `progress`, not `finished_at`, not
        // `abandon_reason` — see the class comment.
        `update resources set title = $2, url = $3, type = $4, trust = $5
          where id = $1::uuid`,
        resourceId,
        fields.title,
        fields.url,
        fields.type,
        fields.trust,
      );
      await linkToMission(tx, userId, resourceId, missionId);
    });
  }

  async rejectExisting(
    userId: string,
    missionId: string,
    resourceId: string,
    reason: string | null,
  ): Promise<void> {
    await this.db.run(userId, async (tx) => {
      await tx.$executeRawUnsafe(
        `update resources set rejected_reason = $2 where id = $1::uuid`,
        resourceId,
        reason,
      );
      await linkToMission(tx, userId, resourceId, missionId);
    });
  }

  async createRejected(
    userId: string,
    missionId: string,
    rejection: WorkspaceRejection,
  ): Promise<void> {
    await this.db.run(userId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        // `reference` rather than `inbox`: the whole point of the rejected list is
        // that it stops the same weak resource being re-evaluated next session, so
        // it must not arrive in the reading queue. `type` is `article` because the
        // rejected list carries no type at all and the column is NOT NULL — the
        // least load-bearing of the seven, for the reason the parser gives.
        `insert into resources (id, user_id, type, title, url, status, rejected_reason, added_at)
         values (gen_random_uuid(), $1::uuid, 'article', $2, $3, 'reference', $4, now())
         returning id`,
        userId,
        rejection.title,
        rejection.url,
        rejection.reason,
      );

      await linkToMission(tx, userId, rows[0]!.id, missionId);
    });
  }
}

/**
 * Link a resource to the mission whose run found it (FR-T8).
 *
 * `id` is supplied explicitly because Prisma's `@default(uuid())` is client-side
 * — the column has no database default, so raw SQL has to mint one.
 *
 * Guarded by `not exists` rather than a unique constraint, because there is none:
 * `resource_links` is a plain join table, and a second run linking the same
 * resource to the same mission would otherwise add a row every time. That would
 * not be visible anywhere except as a resource appearing twice in a mission's
 * library, which is exactly the kind of slow corruption this whole path is
 * arranged to avoid.
 */
async function linkToMission(
  tx: { $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<number> },
  userId: string,
  resourceId: string,
  missionId: string,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `insert into resource_links (id, resource_id, user_id, mission_id)
     select gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid
      where not exists (
        select 1 from resource_links
         where resource_id = $1::uuid and mission_id = $3::uuid
      )`,
    resourceId,
    userId,
    missionId,
  );
}
