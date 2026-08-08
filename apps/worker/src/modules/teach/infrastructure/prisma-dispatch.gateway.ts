import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PrismaClient } from "@mindforge/db";
import { Inject, Injectable } from "@nestjs/common";

import { PRISMA } from "../../../shared/prisma.js";
import type { QueuedRun, TeachDispatchGateway } from "../application/dispatch.port.js";
import { writeTeachPlugin } from "./teach-plugin.js";

@Injectable()
export class PrismaDispatchGateway implements TeachDispatchGateway {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async nextQueued(): Promise<QueuedRun | null> {
    // Cross-user by necessity: nobody is signed in, and the dispatcher's job is
    // to find work wherever it is. Everything after this is scoped by the
    // `user_id` it returns — the same shape as `NightlyGateway.listProfiles`,
    // whose comment calls itself the one place a cross-user read is correct.
    //
    // Joined to `missions` rather than reading `agent_runs.input`, because a
    // workspace key is a fact about the mission: reading the run's copy would let
    // a stale one point a run at a prefix the mission no longer uses.
    const rows = await this.prisma.$queryRawUnsafe<
      { id: string; user_id: string; mission_id: string; workspace_key: string; timezone: string }[]
    >(
      `select r.id, r.user_id, r.mission_id, m.workspace_key, p.timezone
         from agent_runs r
         join missions m on m.id = r.mission_id
         join profiles p on p.id = r.user_id
        where r.status = 'queued'
          and r.kind = 'generate_lesson'
          and m.workspace_key is not null
        order by r.created_at asc
        limit 1`,
    );

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      missionId: row.mission_id,
      workspaceKey: row.workspace_key,
      timezone: row.timezone,
    };
  }

  async writePlugin(runId: string): Promise<{ path: string; skillRef: string }> {
    const root = await mkdtemp(join(tmpdir(), `mindforge-plugin-${runId}-`));
    const plugin = await writeTeachPlugin(root);
    return { path: plugin.path, skillRef: plugin.skillRef };
  }
}
