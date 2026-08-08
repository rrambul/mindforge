import type { ActualMinutes } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { ActualMinutesReader, MinutesWindow } from "../application/actual-minutes.port.js";

interface MinutesRow {
  kind: string;
  id: string;
  minutes: number;
}

/**
 * Raw SQL, because a session has no `minutes` column — its duration is `ended_at - started_at`, which
 * Prisma cannot sum or group by.
 *
 * Three decisions are encoded in the statement and each one changes the numbers on the review screen:
 *
 * **`floor` per session, then sum.** Not the other way round. `elapsedMinutes` in `packages/core`
 * floors each session, so summing seconds and flooring once would drift by up to a minute per session
 * away from the figure shown beside each session on the Today screen — two places disagreeing about
 * the same hours, which is what non-negotiable 3 forbids.
 *
 * **One session, one subject.** `coalesce(mission_id, skill_id)` attributes a block to its mission
 * when it has one and to its skill otherwise. Counting a session that names both against both would
 * make `actualTotal` exceed the hours you actually worked and inflate the week's attainment — a
 * number that looks better than the underlying thing, which non-negotiable 10 rules out. The mission
 * wins because it is the older and more specific attribution: `focus_sessions.skill_id` arrived in M2
 * so that a *skill* allocation has something to compare against, and a session filed under a mission
 * is already accounted for.
 *
 * **Filtered on `started_at`.** A block you began on Sunday night belongs to the week you began it
 * in, even if it finished after midnight — the same rule the goals module's evidence reader uses, and
 * the only one that puts every session in exactly one week.
 *
 * Sessions still running are excluded: a session with no end has no duration, and counting its
 * elapsed time would make the week advance while you sit still.
 */
const MINUTES_BY_SUBJECT = `
  select case when mission_id is not null then 'mission' else 'skill' end as "kind",
         coalesce(mission_id, skill_id)::text as "id",
         sum(greatest(floor(extract(epoch from (ended_at - started_at)) / 60), 0))::float8 as "minutes"
    from focus_sessions
   where ended_at is not null
     and started_at >= $1
     and started_at < $2
     and num_nonnulls(mission_id, skill_id) > 0
   group by 1, 2`;

@Injectable()
export class PrismaActualMinutesReader implements ActualMinutesReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  read(userId: string, window: MinutesWindow): Promise<ActualMinutes[]> {
    return this.db.run(userId, async (tx) => {
      // No `user_id` predicate: RLS scopes the rows, as everywhere else in this app.
      const rows = await tx.$queryRawUnsafe<MinutesRow[]>(
        MINUTES_BY_SUBJECT,
        window.from,
        window.to,
      );

      return rows.map((row) => ({
        // The CASE above produces exactly these two values, so the narrowing is total rather than a
        // cast — and a row that somehow held neither would be counted as a skill rather than crash a
        // read-only screen.
        subject: {
          kind: row.kind === "mission" ? ("mission" as const) : ("skill" as const),
          id: row.id,
        },
        minutes: Number(row.minutes),
      }));
    });
  }
}
