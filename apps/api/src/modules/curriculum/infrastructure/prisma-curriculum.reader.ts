import { asLessonOutcome, type LessonDepth } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type {
  CurriculumReader,
  CurriculumRows,
  LessonRow,
} from "../application/curriculum.port.js";

/**
 * A mission's whole curriculum, in four queries.
 *
 * Four rather than one join: a lesson has many prerequisites and a track has many
 * prerequisites, so a single query would multiply the rows and every count taken
 * from it would be wrong. Assembling the edges here is cheaper than distinct-ing
 * a cartesian product, and much harder to get subtly wrong.
 */
@Injectable()
export class PrismaCurriculumReader implements CurriculumReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  read(userId: string, missionId: string): Promise<CurriculumRows | null> {
    return this.db.run(userId, async (tx) => {
      // RLS answers the ownership question, so a mission that is not this user's
      // returns no row here and the caller 404s — the same answer as one that does
      // not exist, because "yours or not" is itself worth not leaking.
      const [mission] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `select id from missions where id = $1::uuid`,
        missionId,
      );
      if (!mission) return null;

      const [tracks, trackEdges, lessons, lessonEdges] = await Promise.all([
        tx.$queryRawUnsafe<
          {
            id: string;
            slug: string;
            name: string;
            outcome: string | null;
            position: number;
            status: string;
          }[]
        >(
          `select id, slug, name, outcome, position, status from tracks
            where mission_id = $1::uuid order by position, slug`,
          missionId,
        ),
        tx.$queryRawUnsafe<{ track_id: string; name: string }[]>(
          `select e.track_id, p.name from track_edges e
             join tracks p on p.id = e.prereq_id
             join tracks t on t.id = e.track_id
            where t.mission_id = $1::uuid
            order by p.position`,
          missionId,
        ),
        tx.$queryRawUnsafe<
          {
            id: string;
            track_id: string | null;
            slug: string;
            title: string;
            intent: string | null;
            status: string;
            difficulty: number | null;
            depth: LessonDepth | null;
            position: number | null;
            seq: number | null;
            completed_at: Date | null;
            outcome: string | null;
          }[]
        >(
          `select id, track_id, slug, title, intent, status, difficulty, depth, position, seq,
                  completed_at, outcome
             from lessons where mission_id = $1::uuid`,
          missionId,
        ),
        tx.$queryRawUnsafe<{ lesson_id: string; prereq_id: string }[]>(
          `select e.lesson_id, e.prereq_id from lesson_edges e
             join lessons l on l.id = e.lesson_id
            where l.mission_id = $1::uuid`,
          missionId,
        ),
      ]);

      const trackPrereqs = group(trackEdges.map((row) => [row.track_id, row.name] as const));
      const lessonPrereqs = group(
        lessonEdges.map((row) => [row.lesson_id, row.prereq_id] as const),
      );

      return {
        tracks: tracks.map((track) => ({
          ...track,
          prerequisites: trackPrereqs.get(track.id) ?? [],
        })),
        lessons: lessons.map((lesson): LessonRow => ({
          id: lesson.id,
          trackId: lesson.track_id,
          slug: lesson.slug,
          title: lesson.title,
          intent: lesson.intent,
          // Narrowed rather than cast: the column is CHECKed to these two, and a
          // third would be a migration nobody told this file about.
          status: lesson.status === "planned" ? "planned" : "generated",
          difficulty: lesson.difficulty,
          depth: lesson.depth,
          position: lesson.position,
          seq: lesson.seq,
          completedAt: lesson.completed_at,
          outcome: asLessonOutcome(lesson.outcome),
          prerequisiteIds: lessonPrereqs.get(lesson.id) ?? [],
        })),
      };
    });
  }
}

function group(pairs: readonly (readonly [string, string])[]): ReadonlyMap<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const [key, value] of pairs) {
    const existing = grouped.get(key);
    if (existing) existing.push(value);
    else grouped.set(key, [value]);
  }

  return grouped;
}
