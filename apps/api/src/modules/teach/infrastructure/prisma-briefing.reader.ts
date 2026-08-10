import {
  M3_ABSENCES,
  NO_TRACK,
  type BriefingInput,
  type CurrentTrack,
  type Tracked,
} from "@mindforge/workspace";
import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { BriefingReader } from "../application/briefing.port.js";

/**
 * What Mindforge actually knows about a mission, for the briefing.
 *
 * Three of the four inputs it does not have are not queried at all — they have no
 * source table until M4/M5/M6, and `M3_ABSENCES` says so in words the agent
 * reads. Writing a query that returns an empty list for them would be worse than
 * not writing one: an empty list renders as a measurement.
 */

/** Long enough to see a pattern, short enough that last month's friction is not "recent". */
const FRICTION_WINDOW_DAYS = 14;

/** The `## Next` sections the ZPD recommender reads, newest first. */
const ZPD_LIMIT = 8;

@Injectable()
export class PrismaBriefingReader implements BriefingReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  gather(userId: string, missionId: string): Promise<BriefingInput> {
    return this.db.run(userId, async (tx) => {
      const [mission] = await tx.$queryRawUnsafe<{ topic: string }[]>(
        `select topic from missions where id = $1::uuid`,
        missionId,
      );

      const [counts] = await tx.$queryRawUnsafe<{ lessons: bigint; records: bigint }[]>(
        `select
           (select count(*) from lessons where mission_id = $1::uuid) as lessons,
           (select count(*) from learning_records where mission_id = $1::uuid) as records`,
        missionId,
      );

      const records = await tx.$queryRawUnsafe<{ next: string; storage_path: string }[]>(
        `select next, storage_path from learning_records
          where mission_id = $1::uuid and next is not null and next <> ''
          order by recorded_at desc
          limit $2`,
        missionId,
        ZPD_LIMIT,
      );

      // Self-reported only, and the briefing labels them as such. `perceived_level`
      // has its own column and no path to a score precisely so the gap between
      // them stays meaningful (FR-S5).
      // `::text` because the column is a numeric and the briefing renders it as
      // words. Casting in SQL rather than formatting here keeps the decision at
      // the boundary — a Prisma Decimal stringifies differently than a raw number
      // and the difference would show up in a lesson.
      const skills = await tx.$queryRawUnsafe<{ name: string; perceived_level: string | null }[]>(
        `select name, perceived_level::text as perceived_level from skills order by name`,
      );

      // The one genuinely measured signal in the file. `friction_events` has
      // existed since M1, so "none in 14 days" is something Mindforge knows.
      // `type`, not `kind` — friction_events names it `type`, and whether an event
      // was productive is computed from it rather than stored (see classifyFriction),
      // so this reports what was logged rather than a verdict the briefing has no
      // business reaching on its own.
      const friction = await tx.$queryRawUnsafe<{ type: string; occurrences: bigint }[]>(
        `select type, count(*) as occurrences from friction_events
          where occurred_at > now() - make_interval(days => $1)
          group by type
          order by occurrences desc`,
        FRICTION_WINDOW_DAYS,
      );

      return {
        missionTopic: mission?.topic ?? null,
        lessonCount: Number(counts?.lessons ?? 0),
        recordCount: Number(counts?.records ?? 0),
        currentTrack: await readCurrentTrack(tx, missionId),
        zpdCandidates: records.map((record) => ({
          next: record.next,
          fromRecord: record.storage_path.split("/").pop() ?? record.storage_path,
        })),
        skills: skills.map((skill) => ({
          name: skill.name,
          perceivedLevel: skill.perceived_level,
        })),
        recentFriction: friction.map((row) => ({
          kind: row.type,
          occurrences: Number(row.occurrences),
        })),
        frictionWindowDays: FRICTION_WINDOW_DAYS,
        // Not queried, because there is nothing to query. Each carries the
        // sentence the agent must read instead of a zero.
        ...M3_ABSENCES,
      } satisfies BriefingInput;
    });
  }
}

/** The transaction handle `UserScopedDb.run` hands its callback. */
type Tx = { $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T> };

/**
 * The open module, or the reason there isn't one.
 *
 * The two null cases are told apart deliberately. "No curriculum" and "a
 * curriculum with nothing open" call for different behaviour from the agent —
 * teach from the mission in both, but only in the second is leaving the meta tag
 * off a decision rather than the only option — and collapsing them into one
 * `null` would leave the briefing unable to say which.
 */
async function readCurrentTrack(tx: Tx, missionId: string): Promise<Tracked<CurrentTrack>> {
  const [total] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    // `dropped` tracks are excluded from the denominator: they are retained so a
    // module of finished lessons survives a regenerated curriculum, not because
    // they are still part of the plan.
    `select count(*) as n from tracks where mission_id = $1::uuid and status <> 'dropped'`,
    missionId,
  );

  const totalTracks = Number(total?.n ?? 0);
  if (totalTracks === 0) return NO_TRACK.noCurriculum;

  const [track] = await tx.$queryRawUnsafe<
    { id: string; slug: string; name: string; outcome: string | null; position: number }[]
  >(
    // One row at most: `tracks_one_active_per_mission_key` is a partial unique index.
    `select id, slug, name, outcome, position from tracks
      where mission_id = $1::uuid and status = 'active'`,
    missionId,
  );

  if (!track) return NO_TRACK.noneOpen;

  const [prerequisites, skills, lessons] = await Promise.all([
    tx.$queryRawUnsafe<{ name: string }[]>(
      `select p.name from track_edges e
         join tracks p on p.id = e.prereq_id
        where e.track_id = $1::uuid
        order by p.position`,
      track.id,
    ),
    tx.$queryRawUnsafe<{ name: string }[]>(
      `select s.name from track_skills ts
         join skills s on s.id = ts.skill_id
        where ts.track_id = $1::uuid
        order by s.name`,
      track.id,
    ),
    tx.$queryRawUnsafe<{ seq: number; title: string }[]>(
      `select seq, title from lessons where track_id = $1::uuid order by seq`,
      track.id,
    ),
  ]);

  return {
    slug: track.slug,
    name: track.name,
    outcome: track.outcome,
    position: track.position,
    totalTracks,
    prerequisites: prerequisites.map((row) => row.name),
    skills: skills.map((row) => row.name),
    lessons: lessons.map((row) => ({ seq: row.seq, title: row.title })),
  };
}
