import { FRICTION_TYPES, type FrictionType } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type {
  FrictionAnalyticsFilter,
  FrictionAnalyticsReader,
  FrictionCell,
} from "../application/friction-analytics.port.js";

interface CrossTabRow {
  type: string;
  missionId: string | null;
  missionTopic: string | null;
  count: number;
  intensitySum: number;
  standaloneCount: number;
}

/**
 * The (type × mission) cross-tab, in one grouped query.
 *
 * **Raw SQL because the grouping key spans a join.** Mission is two hops from a friction event —
 * `friction_events → focus_sessions → missions` — and Prisma's `groupBy` can only group by columns
 * of the model it is called on. The alternatives were loading every event to group in TypeScript
 * (which is what `/friction/summary` does, and is fine for the split but wasteful for eleven
 * integers) or two aggregate queries that could disagree with each other.
 *
 * **Both joins are LEFT joins, and that is the honest part.** A standalone tap has no session, and
 * a session may have no mission; an inner join would silently drop exactly the events FR-C1 calls
 * the escape hatch for, and the totals would then be quietly smaller than `/friction/summary`'s.
 *
 * No `user_id` predicate: RLS scopes all three tables, and `db.run` is what puts the claims in
 * force. Adding one by hand here would be a second, weaker copy of the real protection.
 */
@Injectable()
export class PrismaFrictionAnalyticsReader implements FrictionAnalyticsReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  crossTab(userId: string, filter: FrictionAnalyticsFilter): Promise<FrictionCell[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Built as separate predicates rather than `($1 is null or …)`, so the planner can use
    // `(user_id, occurred_at)` instead of scanning to evaluate a null check per row.
    if (filter.since !== undefined) {
      params.push(filter.since);
      conditions.push(`f.occurred_at >= $${params.length}`);
    }
    if (filter.until !== undefined) {
      params.push(filter.until);
      // Strictly less-than: an event at exactly the week's first instant belongs to that week, and
      // `<=` on the boundary would let two adjacent weeks both count it.
      conditions.push(`f.occurred_at < $${params.length}`);
    }
    if (filter.missionId !== undefined) {
      params.push(filter.missionId);
      conditions.push(`s.mission_id = $${params.length}::uuid`);
    }

    const sql = `
      select f.type                                                  as "type",
             s.mission_id                                            as "missionId",
             m.topic                                                 as "missionTopic",
             count(*)::int                                           as "count",
             sum(f.intensity)::int                                   as "intensitySum",
             (count(*) filter (where f.session_id is null))::int      as "standaloneCount"
        from friction_events f
        left join focus_sessions s on s.id = f.session_id
        left join missions m on m.id = s.mission_id
       ${conditions.length === 0 ? "" : `where ${conditions.join(" and ")}`}
       group by f.type, s.mission_id, m.topic`;

    return this.db.run(userId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<CrossTabRow[]>(sql, ...params);

      return rows.flatMap((row) =>
        // A row whose type the taxonomy no longer knows is skipped rather than thrown on, matching
        // `countByType`: FR-C1 says the eleven will be refined with real data, and a retired value
        // must not be able to take the whole review screen down.
        isFrictionType(row.type)
          ? [
              {
                type: row.type,
                missionId: row.missionId,
                missionTopic: row.missionTopic,
                count: row.count,
                intensitySum: row.intensitySum,
                standaloneCount: row.standaloneCount,
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
