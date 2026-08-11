import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { MissionWorkspace, MissionWorkspaceReader } from "../application/teach.port.js";

/**
 * The narrow slice of `missions` the teach module is allowed to touch.
 *
 * Reads three columns and writes one, and the one it writes is `workspace_key` —
 * a fact about the Storage prefix rather than about the mission, which no other
 * module has any reason to set. Everything else about a mission still goes
 * through the missions module's own use cases (§2.1 decision 2: whoever owns the
 * table owns the write).
 */
@Injectable()
export class PrismaMissionWorkspaceReader implements MissionWorkspaceReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  async find(userId: string, missionId: string): Promise<MissionWorkspace | null> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<
        {
          id: string;
          topic: string;
          status: string;
          workspace_key: string | null;
          has_curriculum: boolean;
        }[]
      >(
        // `exists` rather than a count: the question is whether there is a plan at
        // all, and Postgres stops at the first row.
        `select m.id, m.topic, m.status, m.workspace_key,
                exists (select 1 from tracks t where t.mission_id = m.id) as has_curriculum
           from missions m where m.id = $1::uuid`,
        missionId,
      ),
    );

    const row = rows[0];
    if (!row) return null;

    return {
      missionId: row.id,
      topic: row.topic,
      status: row.status,
      workspaceKey: row.workspace_key,
      hasCurriculum: row.has_curriculum,
    };
  }

  async takenKeys(userId: string): Promise<readonly string[]> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<{ workspace_key: string }[]>(
        `select workspace_key from missions where workspace_key is not null`,
      ),
    );
    return rows.map((row) => row.workspace_key);
  }

  async claimWorkspaceKey(userId: string, missionId: string, key: string): Promise<string> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<{ workspace_key: string }[]>(
        // `where workspace_key is null` is what makes this set-once. Two first
        // runs racing on an untaught mission would otherwise assign different
        // keys and point at two prefixes, splitting the learner's history in half
        // with nothing to say it happened.
        `update missions set workspace_key = $2, updated_at = now()
          where id = $1::uuid and workspace_key is null
          returning workspace_key`,
        missionId,
        key,
      ),
    );

    if (rows[0]) return rows[0].workspace_key;

    // Somebody won the race, or it was already set. Read back theirs rather than
    // failing: the caller wants a prefix, and which of two simultaneous callers
    // named it is not information anybody needs.
    const existing = await this.find(userId, missionId);
    return existing?.workspaceKey ?? key;
  }
}
