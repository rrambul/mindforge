import {
  elapsedMinutes,
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

  listForSession(userId: string, sessionId: string): Promise<FrictionEvent[]> {
    return this.db.run(userId, async (tx) => {
      const rows = await tx.frictionEvent.findMany({
        where: { sessionId },
        orderBy: { occurredAt: "asc" },
        select: COLUMNS,
      });
      return rows.map(toEvent);
    });
  }

  listClassifiable(userId: string, filter: FrictionFilter): Promise<ClassifiableFrictionEvent[]> {
    return this.db.run(userId, async (tx) => {
      const rows = await tx.frictionEvent.findMany({
        where: {
          ...(filter.since || filter.until
            ? {
                occurredAt: {
                  ...(filter.since ? { gte: filter.since } : {}),
                  // Exclusive: an event at exactly midnight belongs to the week beginning, not to
                  // the one ending, and `lte` would let both weeks count it.
                  ...(filter.until ? { lt: filter.until } : {}),
                },
              }
            : {}),
          // Friction inherits its mission from the session it happened in — events logged
          // outside a session have no mission and are correctly excluded by this filter.
          ...(filter.missionId ? { session: { missionId: filter.missionId } } : {}),
        },
        orderBy: { occurredAt: "desc" },
        select: {
          type: true,
          intensity: true,
          occurredAt: true,
          sessionId: true,
          // The outcome the classification turns on, and the length the split divides. Joined
          // rather than fetched per event: classifying 200 events would otherwise be 200 extra
          // queries.
          session: { select: { hitIntention: true, startedAt: true, endedAt: true } },
        },
      });

      return rows.flatMap((row) =>
        isFrictionType(row.type)
          ? [
              {
                type: row.type,
                intensity: row.intensity,
                occurredAt: row.occurredAt,
                sessionId: row.sessionId,
                // Clipped to the window, not the session's whole length.
                //
                // Events are filtered by `[since, until)` and then grouped by session, so a session
                // straddling a week boundary used to hand its *entire* duration to both weeks — the
                // same double count the `until` bound was added to remove, one layer down. Clipping
                // gives each week only the part of the session that happened inside it.
                //
                // `elapsedMinutes` rather than arithmetic: it floors, and a second rounding rule in
                // this file would make a 59.6-minute session 60 minutes to the split and 59
                // everywhere else.
                sessionMinutes:
                  row.session?.endedAt == null
                    ? null
                    : elapsedMinutes(
                        laterOf(row.session.startedAt, filter.since),
                        earlierOf(row.session.endedAt, filter.until),
                      ),
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

/**
 * The window's bounds applied to a session's own, so a straddling session is counted once per week.
 *
 * `elapsedMinutes` floors at zero, so a session entirely outside the window — which the event filter
 * makes unreachable, since the event is inside it — would contribute nothing rather than a negative.
 */
function laterOf(instant: Date, bound: Date | undefined): Date {
  return bound !== undefined && bound > instant ? bound : instant;
}

function earlierOf(instant: Date, bound: Date | undefined): Date {
  return bound !== undefined && bound < instant ? bound : instant;
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
