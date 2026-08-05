import type { MissionStatus } from "@mindforge/core";
import type { RlsTransaction } from "@mindforge/db";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { Mission, type MissionRevisionDraft, type MissionSnapshot } from "../domain/mission.js";
import type { MissionFilter, MissionRepository } from "../domain/mission.repository.js";

/** The columns a Mission is built from. Narrower than the row, on purpose. */
interface MissionRow {
  id: string;
  userId: string;
  topic: string;
  why: string | null;
  successLooksLike: string | null;
  constraints: string | null;
  currentLevel: string | null;
  status: string;
  workspaceKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const MISSION_COLUMNS = {
  id: true,
  userId: true,
  topic: true,
  why: true,
  successLooksLike: true,
  constraints: true,
  currentLevel: true,
  status: true,
  workspaceKey: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Prisma lives here and nowhere else (§2.1). The domain sees entities; this file is
 * the only thing that knows a mission is a row.
 *
 * Every method opens its own `run`, which is one transaction with the caller's RLS
 * claims in force. Postgres does the authorising — there is no `where: { userId }`
 * below, and that absence is the design: a policy that is enforced by the database
 * cannot be forgotten by a query, whereas a hand-written filter is forgotten
 * exactly once.
 */
@Injectable()
export class PrismaMissionRepository implements MissionRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  findById(userId: string, id: string): Promise<Mission | null> {
    return this.db.run(userId, async (tx) => {
      const row = await tx.mission.findUnique({ where: { id }, select: MISSION_COLUMNS });
      return row ? toMission(row) : null;
    });
  }

  list(userId: string, filter: MissionFilter): Promise<Mission[]> {
    return this.db.run(userId, async (tx) => {
      const rows = await tx.mission.findMany({
        ...(filter.status ? { where: { status: filter.status } } : {}),
        // Active first, then most recently touched. The Today screen wants the
        // mission you are actually on at the top, not the one you created first.
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        select: MISSION_COLUMNS,
      });
      return rows.map(toMission);
    });
  }

  countActive(userId: string): Promise<number> {
    return this.db.run(userId, (tx) => tx.mission.count({ where: { status: "active" } }));
  }

  async create(userId: string, mission: Mission): Promise<void> {
    const snapshot = mission.toSnapshot();
    await this.db.run(userId, (tx) =>
      tx.mission.create({
        data: {
          id: snapshot.id,
          // Written explicitly rather than taken from the RLS claim, so the
          // WITH CHECK half of the policy is actually exercised. If these ever
          // disagreed, Postgres would reject the insert — which is the behaviour
          // we want and the RLS suite proves.
          userId: snapshot.userId,
          topic: snapshot.topic,
          why: snapshot.why,
          successLooksLike: snapshot.successLooksLike,
          constraints: snapshot.constraints,
          currentLevel: snapshot.currentLevel,
          status: snapshot.status,
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
        },
      }),
    );
  }

  async update(
    userId: string,
    mission: Mission,
    revision: MissionRevisionDraft | null,
  ): Promise<void> {
    const snapshot = mission.toSnapshot();

    await this.db.run(userId, async (tx) => {
      await tx.mission.update({
        where: { id: snapshot.id },
        data: {
          topic: snapshot.topic,
          why: snapshot.why,
          successLooksLike: snapshot.successLooksLike,
          constraints: snapshot.constraints,
          currentLevel: snapshot.currentLevel,
          status: snapshot.status,
          // Prisma's @updatedAt would stamp server-local now(). The entity's clock
          // is injected and the value is already decided; overriding keeps the two
          // from disagreeing by however long the round trip took.
          updatedAt: snapshot.updatedAt,
        },
      });

      if (revision) await appendRevision(tx, revision);
    });
  }
}

/**
 * Inside the caller's transaction, so FR-M2's history cannot end up partial: either
 * the mission and its revision both land, or neither does.
 */
async function appendRevision(tx: RlsTransaction, revision: MissionRevisionDraft): Promise<void> {
  await tx.missionRevision.create({
    data: {
      missionId: revision.missionId,
      userId: revision.userId,
      changedAt: revision.changedAt,
      reason: revision.reason,
      // Only the fields that moved, and their previous values. The interesting
      // question about drift is always "what moved", never "what was the whole
      // thing" — and a full snapshot per edit would make the history unreadable.
      snapshot: { changed: revision.changed, previous: revision.previous },
    },
  });
}

function toMission(row: MissionRow): Mission {
  return Mission.fromSnapshot(toSnapshot(row));
}

function toSnapshot(row: MissionRow): MissionSnapshot {
  return {
    id: row.id,
    userId: row.userId,
    topic: row.topic,
    why: row.why,
    successLooksLike: row.successLooksLike,
    constraints: row.constraints,
    currentLevel: row.currentLevel,
    // `status` is a text column with no check constraint, so a hand-edited row can
    // hold anything. Narrowed here rather than trusted, at the one boundary where a
    // row becomes an entity.
    status: toStatus(row.status),
    workspaceKey: row.workspaceKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set<MissionStatus>([
  "active",
  "parked",
  "completed",
  "abandoned",
]);

function toStatus(value: string): MissionStatus {
  if (!KNOWN_STATUSES.has(value)) {
    throw new TypeError(`Mission row has unknown status "${value}"`);
  }
  return value as MissionStatus;
}
