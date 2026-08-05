import {
  FRICTION_TYPES,
  producedLearning,
  type FrictionType,
  type IntentionOutcome,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { FrictionEvent } from "../domain/friction-event.js";
import type {
  ClassifiableFrictionEvent,
  FrictionEventRepository,
  FrictionFilter,
} from "../domain/friction-event.repository.js";

const COLUMNS = {
  id: true,
  userId: true,
  type: true,
  intensity: true,
  note: true,
  occurredAt: true,
  sessionId: true,
  skillId: true,
  resourceId: true,
  taskId: true,
} as const;

interface FrictionRow {
  id: string;
  userId: string;
  type: string;
  intensity: number;
  note: string | null;
  occurredAt: Date;
  sessionId: string | null;
  skillId: string | null;
  resourceId: string | null;
  taskId: string | null;
}

@Injectable()
export class PrismaFrictionEventRepository implements FrictionEventRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  findById(userId: string, id: string): Promise<FrictionEvent | null> {
    return this.db.run(userId, async (tx) => {
      const row = await tx.frictionEvent.findUnique({ where: { id }, select: COLUMNS });
      return row ? toEvent(row) : null;
    });
  }

  async save(userId: string, event: FrictionEvent): Promise<void> {
    const e = event.toSnapshot();

    const mutable = {
      type: e.type,
      intensity: e.intensity,
      note: e.note,
      sessionId: e.sessionId,
      skillId: e.skillId,
      resourceId: e.resourceId,
      taskId: e.taskId,
    };

    await this.db.run(userId, (tx) =>
      tx.frictionEvent.upsert({
        where: { id: e.id },
        create: { id: e.id, userId: e.userId, occurredAt: e.occurredAt, ...mutable },
        // `occurredAt` is absent: a replayed tap must not move when the friction happened.
        update: mutable,
      }),
    );
  }

  countByType(userId: string, since: Date): Promise<Partial<Record<FrictionType, number>>> {
    return this.db.run(userId, async (tx) => {
      // groupBy rather than loading events: this runs on every render of the capture bar and
      // the answer is at most eleven integers. Uses the (user_id, type, occurred_at) index.
      const grouped = await tx.frictionEvent.groupBy({
        by: ["type"],
        where: { occurredAt: { gte: since } },
        _count: { _all: true },
      });

      const counts: Partial<Record<FrictionType, number>> = {};
      for (const group of grouped) {
        // A row with an unrecognised type is skipped rather than throwing. The chip ranking is
        // decoration over a taxonomy that may gain values (FR-C1 says refine with real data),
        // and it must not be the thing that takes the capture bar down.
        if (isFrictionType(group.type)) counts[group.type] = group._count._all;
      }
      return counts;
    });
  }

  listClassifiable(userId: string, filter: FrictionFilter): Promise<ClassifiableFrictionEvent[]> {
    return this.db.run(userId, async (tx) => {
      const rows = await tx.frictionEvent.findMany({
        where: {
          ...(filter.since ? { occurredAt: { gte: filter.since } } : {}),
          // Friction inherits its mission from the session it happened in — events logged
          // outside a session have no mission and are correctly excluded by this filter.
          ...(filter.missionId ? { session: { missionId: filter.missionId } } : {}),
        },
        orderBy: { occurredAt: "desc" },
        select: {
          type: true,
          intensity: true,
          occurredAt: true,
          // The outcome the classification turns on. Joined rather than fetched per event:
          // classifying 200 events would otherwise be 200 extra queries.
          session: { select: { hitIntention: true } },
        },
      });

      return rows.flatMap((row) =>
        isFrictionType(row.type)
          ? [
              {
                type: row.type,
                intensity: row.intensity,
                occurredAt: row.occurredAt,
                sessionProducedLearning:
                  row.session === null
                    ? null
                    : producedLearning(row.session.hitIntention as IntentionOutcome | null),
              },
            ]
          : [],
      );
    });
  }
}

const KNOWN: ReadonlySet<string> = new Set(FRICTION_TYPES);

function isFrictionType(value: string): value is FrictionType {
  return KNOWN.has(value);
}

function toEvent(row: FrictionRow): FrictionEvent {
  if (!isFrictionType(row.type)) {
    // Unlike the aggregate reads above, a single event being returned to a caller must not
    // silently claim a type it does not have.
    throw new TypeError(`friction_events.type has unknown value "${row.type}"`);
  }

  return FrictionEvent.fromSnapshot({
    id: row.id,
    userId: row.userId,
    type: row.type,
    intensity: row.intensity,
    note: row.note,
    occurredAt: row.occurredAt,
    sessionId: row.sessionId,
    skillId: row.skillId,
    resourceId: row.resourceId,
    taskId: row.taskId,
  });
}
