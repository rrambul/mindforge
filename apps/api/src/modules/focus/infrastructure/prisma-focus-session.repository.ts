import { ENTRY_MODES, INTENTION_OUTCOMES } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { FocusSession, type FocusSessionSnapshot } from "../domain/focus-session.js";
import type {
  FocusSessionFilter,
  FocusSessionRepository,
} from "../domain/focus-session.repository.js";

interface FocusSessionRow {
  id: string;
  userId: string;
  intention: string | null;
  startedAt: Date;
  endedAt: Date | null;
  plannedMinutes: number | null;
  hitIntention: string | null;
  focusQuality: number | null;
  energy: number | null;
  note: string | null;
  entryMode: string;
  missionId: string | null;
  createdAt: Date;
}

const COLUMNS = {
  id: true,
  userId: true,
  intention: true,
  startedAt: true,
  endedAt: true,
  plannedMinutes: true,
  hitIntention: true,
  focusQuality: true,
  energy: true,
  note: true,
  entryMode: true,
  missionId: true,
  createdAt: true,
} as const;

/**
 * Prisma lives here and nowhere else (§2.1).
 *
 * No `where: { userId }` anywhere below — the caller's RLS claims are in force for the whole
 * transaction, and Postgres does the authorising. A policy the database enforces cannot be
 * forgotten by a query; a hand-written filter is forgotten exactly once.
 */
@Injectable()
export class PrismaFocusSessionRepository implements FocusSessionRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  findById(userId: string, id: string): Promise<FocusSession | null> {
    return this.db.run(userId, async (tx) => {
      const row = await tx.focusSession.findUnique({ where: { id }, select: COLUMNS });
      return row ? toSession(row) : null;
    });
  }

  findRunning(userId: string): Promise<FocusSession | null> {
    return this.db.run(userId, async (tx) => {
      const row = await tx.focusSession.findFirst({
        // A running session is one with no end. Ordered newest-first so that if a bug ever
        // did leave two open, the app follows the one you actually started last rather than
        // resurrecting an abandoned timer from last week.
        where: { endedAt: null },
        orderBy: { startedAt: "desc" },
        select: COLUMNS,
      });
      return row ? toSession(row) : null;
    });
  }

  list(userId: string, filter: FocusSessionFilter): Promise<FocusSession[]> {
    return this.db.run(userId, async (tx) => {
      const rows = await tx.focusSession.findMany({
        where: {
          ...(filter.missionId ? { missionId: filter.missionId } : {}),
          ...(filter.since ? { startedAt: { gte: filter.since } } : {}),
        },
        // Uses the (user_id, started_at) index. Newest first: the Today screen reads the top.
        orderBy: { startedAt: "desc" },
        ...(filter.limit === undefined ? {} : { take: filter.limit }),
        select: COLUMNS,
      });
      return rows.map(toSession);
    });
  }

  /**
   * Upsert on the primary key, which is what makes the capture endpoints idempotent (§6.1).
   *
   * `create` and `update` carry the same values on purpose: a replayed capture must converge
   * on the same row rather than half-updating one. `startedAt`, `entryMode`, and `createdAt`
   * are absent from `update` because they are set once — a replayed stop must not move the
   * start time.
   */
  async save(userId: string, session: FocusSession): Promise<void> {
    const s = session.toSnapshot();

    const mutable = {
      intention: s.intention,
      endedAt: s.endedAt,
      plannedMinutes: s.plannedMinutes,
      hitIntention: s.hitIntention,
      focusQuality: s.focusQuality,
      energy: s.energy,
      note: s.note,
      missionId: s.missionId,
    };

    await this.db.run(userId, (tx) =>
      tx.focusSession.upsert({
        where: { id: s.id },
        create: {
          id: s.id,
          // Written explicitly rather than taken from the claim, so the policy's WITH CHECK
          // half is actually exercised on every insert.
          userId: s.userId,
          startedAt: s.startedAt,
          entryMode: s.entryMode,
          createdAt: s.createdAt,
          ...mutable,
        },
        update: mutable,
      }),
    );
  }
}

function toSession(row: FocusSessionRow): FocusSession {
  return FocusSession.fromSnapshot(toSnapshot(row));
}

function toSnapshot(row: FocusSessionRow): FocusSessionSnapshot {
  return {
    id: row.id,
    userId: row.userId,
    intention: row.intention,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    plannedMinutes: row.plannedMinutes,
    // Both are free-text columns with no check constraint, so a hand-edited row can hold
    // anything. Narrowed at the one boundary where a row becomes an entity.
    hitIntention: narrow(row.hitIntention, INTENTION_OUTCOMES, "hit_intention"),
    focusQuality: row.focusQuality,
    energy: row.energy,
    note: row.note,
    entryMode: narrow(row.entryMode, ENTRY_MODES, "entry_mode") ?? "timer",
    missionId: row.missionId,
    createdAt: row.createdAt,
  };
}

function narrow<T extends string>(
  value: string | null,
  allowed: readonly T[],
  column: string,
): T | null {
  if (value === null) return null;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`focus_sessions.${column} has unknown value "${value}"`);
  }
  return value as T;
}
