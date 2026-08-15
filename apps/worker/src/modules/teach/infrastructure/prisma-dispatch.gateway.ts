import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PrismaClient } from "@mindforge/db";
import { Inject, Injectable } from "@nestjs/common";

import type { BriefingKind } from "@mindforge/workspace";
import { PRISMA } from "../../../shared/prisma.js";
import type { QueuedRun, TeachDispatchGateway } from "../application/dispatch.port.js";

import { writeCurriculumPlugin, writeTeachPlugin } from "./teach-plugin.js";

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
      {
        id: string;
        user_id: string;
        mission_id: string;
        kind: string;
        workspace_key: string;
        timezone: string;
      }[]
    >(
      // Both kinds, and the `in` list is the enumeration on purpose: `agent_runs`
      // allows kinds this worker cannot run (`sync_workspace`, and the assessment
      // kinds M6 cut), and claiming one would hold the mission's single-active-run
      // slot while nothing happened.
      //
      // **Round-robin by learner, FIFO within one.** The ordering used to be
      // `created_at` alone, which is fair between *runs* and unfair between
      // *people*: this process runs one agent at a time (see `TeachDispatcher`'s
      // `busy`), a run takes about eight minutes, and the single-active-run index
      // is per mission rather than per user. So a learner who pressed the button on
      // six missions owned the worker for the next three quarters of an hour, and
      // everybody else waited behind all six with nothing on any screen to say why.
      //
      // The key is when that learner's last run *started*, oldest first, so the
      // person served longest ago goes next. `to_timestamp(0)` puts somebody who
      // has never had a run at the very front — a first mission should not queue
      // behind the backlog of whoever is already here.
      //
      // Correlated rather than a `group by` over the whole table: the outer set is
      // only the runnable rows, so this evaluates a handful of times and rides the
      // `(user_id, started_at)` index rather than aggregating every run ever made.
      `select r.id, r.user_id, r.mission_id, r.kind, m.workspace_key, p.timezone
         from agent_runs r
         join missions m on m.id = r.mission_id
         join profiles p on p.id = r.user_id
        where r.status = 'queued'
          and r.kind in ('generate_lesson', 'generate_curriculum')
          and m.workspace_key is not null
        order by
          coalesce(
            (select max(prior.started_at)
               from agent_runs prior
              where prior.user_id = r.user_id
                and prior.started_at is not null),
            to_timestamp(0)
          ) asc,
          r.created_at asc
        limit 1`,
    );

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      missionId: row.mission_id,
      // Narrowed rather than cast: the `in` list above is what the query allows,
      // and a third value here would be a widened filter nobody told this line about.
      kind: row.kind === "generate_curriculum" ? "generate_curriculum" : "generate_lesson",
      workspaceKey: row.workspace_key,
      timezone: row.timezone,
    };
  }

  async writePlugin(
    runId: string,
    kind: BriefingKind,
  ): Promise<{ path: string; skillRef: string }> {
    const root = await mkdtemp(join(tmpdir(), `mindforge-plugin-${runId}-`));
    const write = kind === "generate_curriculum" ? writeCurriculumPlugin : writeTeachPlugin;
    const plugin = await write(root);
    return { path: plugin.path, skillRef: plugin.skillRef };
  }
}
