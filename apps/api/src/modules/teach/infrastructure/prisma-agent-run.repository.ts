import { Inject, Injectable } from "@nestjs/common";

import type { PrismaClient } from "@mindforge/db";

import {
  PRISMA,
  USER_SCOPED_DB,
  type UserScopedDb,
} from "../../../shared/persistence/user-scoped-db.js";
import type {
  AgentRun,
  AgentRunKind,
  AgentRunResult,
  AgentRunStatus,
} from "../domain/agent-run.js";
import { ACTIVE_STATUSES } from "../domain/agent-run.js";
import type {
  AgentRunRepository,
  CreateAgentRun,
  FinishAgentRun,
} from "../domain/agent-run.repository.js";

/** Postgres's unique-violation code. */
const UNIQUE_VIOLATION = "23505";

/** The partial index that enforces one active run per mission. */
const ACTIVE_RUN_INDEX = "agent_runs_one_active_per_mission_key";

interface Row {
  id: string;
  user_id: string;
  mission_id: string | null;
  kind: string;
  status: string;
  // Typed at the boundary rather than cast at every read. jsonb comes back as
  // whatever was written, so this is an assertion either way — making it once,
  // here, is the honest place for it.
  input: Readonly<Record<string, unknown>> | null;
  result: AgentRunResult | null;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  heartbeat_at: Date | null;
  finished_at: Date | null;
}

function toDomain(row: Row): AgentRun {
  return {
    id: row.id,
    userId: row.user_id,
    missionId: row.mission_id,
    kind: row.kind as AgentRunKind,
    status: row.status as AgentRunStatus,
    input: row.input ?? null,
    result: row.result ?? null,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    finishedAt: row.finished_at,
  };
}

/**
 * A `23505` from **our** index, and not from any other.
 *
 * Naming the constraint matters as much as reading the SQLSTATE. "Any unique
 * violation means a run is already active" would swallow a duplicate primary key
 * — an id collision, or a retry that resent a run — and answer 409 "this mission
 * is already being taught", which is a wrong sentence in front of the user about
 * a bug nobody would then look for. Same mistake in a different costume as a bare
 * `rejects.toThrow()`.
 *
 * The shape is nested because raw SQL surfaces the driver adapter's error inside
 * Prisma's: `P2010` on the outside, `23505` and the constraint name within.
 * Matching on the message text instead would break the first time Postgres is
 * localised.
 */
function isActiveRunConflict(error: unknown): boolean {
  const cause = (
    error as {
      meta?: {
        driverAdapterError?: {
          cause?: { originalCode?: string; originalMessage?: string };
        };
      };
    }
  )?.meta?.driverAdapterError?.cause;

  if (cause?.originalCode !== UNIQUE_VIOLATION) return false;
  return cause.originalMessage?.includes(ACTIVE_RUN_INDEX) ?? false;
}

const COLUMNS = `id, user_id, mission_id, kind, status, input, result, error,
                 created_at, started_at, heartbeat_at, finished_at`;

/**
 * `agent_runs`, in raw SQL rather than through the Prisma client.
 *
 * Three of these five writes are compare-and-swaps whose whole value is that the
 * condition and the update are one statement. Prisma's `updateMany` could express
 * two of them, but not `RETURNING` — and "did I win the race" is exactly what the
 * caller needs to know, so a second read to find out would reopen the gap the CAS
 * closed.
 */
@Injectable()
export class PrismaAgentRunRepository implements AgentRunRepository {
  constructor(
    @Inject(USER_SCOPED_DB) private readonly db: UserScopedDb,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async create(userId: string, run: CreateAgentRun): Promise<AgentRun | null> {
    try {
      const rows = await this.db.run(userId, (tx) =>
        tx.$queryRawUnsafe<Row[]>(
          `insert into agent_runs (id, user_id, mission_id, kind, status, input)
           values ($1::uuid, $2::uuid, $3::uuid, $4, 'queued', $5::jsonb)
           returning ${COLUMNS}`,
          run.id,
          userId,
          run.missionId,
          run.kind,
          JSON.stringify(run.input ?? {}),
        ),
      );
      return rows[0] ? toDomain(rows[0]) : null;
    } catch (error) {
      // `agent_runs_one_active_per_mission_key`. Null rather than a rethrow: one
      // active run per mission is a product rule, and the use case turns it into
      // a 409 with a slug the SPA can branch on. Two dispatcher ticks racing is
      // precisely why this is a constraint rather than a check-then-insert.
      if (isActiveRunConflict(error)) return null;
      throw error;
    }
  }

  async find(userId: string, id: string): Promise<AgentRun | null> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<Row[]>(`select ${COLUMNS} from agent_runs where id = $1::uuid`, id),
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listForMission(userId: string, missionId: string, limit: number): Promise<AgentRun[]> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<Row[]>(
        `select ${COLUMNS} from agent_runs
          where mission_id = $1::uuid
          order by created_at desc
          limit $2`,
        missionId,
        limit,
      ),
    );
    return rows.map(toDomain);
  }

  async claim(userId: string, id: string, at: Date): Promise<AgentRun | null> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<Row[]>(
        // The `and status = 'queued'` is the whole mechanism: two dispatchers
        // both see `queued` on a read, and only one of them can satisfy this.
        `update agent_runs
            set status = 'running', started_at = $2::timestamptz, heartbeat_at = $2::timestamptz
          where id = $1::uuid and status = 'queued'
          returning ${COLUMNS}`,
        id,
        at,
      ),
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async heartbeat(userId: string, id: string, at: Date): Promise<boolean> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(
        `update agent_runs set heartbeat_at = $2::timestamptz
          where id = $1::uuid and status = 'running'
          returning id`,
        id,
        at,
      ),
    );
    return rows.length > 0;
  }

  async finish(
    userId: string,
    id: string,
    at: Date,
    outcome: FinishAgentRun,
  ): Promise<AgentRun | null> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<Row[]>(
        // Conditioned on still being active, so a second finish — a worker that
        // recovered after the reaper gave up on it — changes nothing rather than
        // overwriting the reaper's verdict with a stale success.
        `update agent_runs
            set status = $3, result = $4::jsonb, error = $5, finished_at = $2::timestamptz
          where id = $1::uuid and status = any($6::text[])
          returning ${COLUMNS}`,
        id,
        at,
        outcome.status,
        outcome.result === null ? null : JSON.stringify(outcome.result),
        outcome.error,
        [...ACTIVE_STATUSES],
      ),
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findStale(before: Date, limit: number): Promise<AgentRun[]> {
    // The one cross-user read here, and the one query that does **not** go
    // through `UserScopedDb`: nobody is signed in when a worker dies, so there is
    // no user to scope to. Every write the reaper makes afterwards is scoped by
    // the `userId` it reads back from these rows — the same shape as
    // `NightlyGateway.listProfiles`, and the reason that method's comment calls
    // itself the one place a cross-user read is correct.
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `select ${COLUMNS} from agent_runs
        where status = 'running'
          and coalesce(heartbeat_at, started_at, created_at) < $1::timestamptz
        order by coalesce(heartbeat_at, started_at, created_at) asc
        limit $2`,
      before,
      limit,
    );
    return rows.map(toDomain);
  }
}
