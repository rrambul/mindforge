import { asLessonOutcome, ExerciseDeclarationSchema, type LessonDepth } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { judgeLessons, type QueryTx as Tx } from "../../exercises/infrastructure/judge-lessons.js";
import type {
  CurriculumReader,
  CurriculumRows,
  ExamItemRow,
  ExamRow,
  LessonRow,
  PaceRows,
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

  read(userId: string, missionId: string, paceSince: Date): Promise<CurriculumRows | null> {
    return this.db.run(userId, async (tx) => {
      // RLS answers the ownership question, so a mission that is not this user's
      // returns no row here and the caller 404s — the same answer as one that does
      // not exist, because "yours or not" is itself worth not leaking.
      const [mission] = await tx.$queryRawUnsafe<
        { id: string; weeks: number | null; starts_on: string | null }[]
      >(
        // `::text` on a date is `YYYY-MM-DD`: the learner's own day, with no instant
        // to shift across midnight on the way out.
        `select id, weeks, starts_on::text as starts_on from missions where id = $1::uuid`,
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
            week: number | null;
          }[]
        >(
          `select id, slug, name, outcome, position, status, week from tracks
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
            exercises: unknown;
            adjustment: string | null;
            adjustment_reason: string | null;
            bridge_for_slug: string | null;
            kind: string;
          }[]
        >(
          `select id, track_id, slug, title, intent, status, difficulty, depth, position, seq,
                  completed_at, outcome, exercises, adjustment, adjustment_reason, bridge_for_slug,
                  kind
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

      // Split once, here: everything below about lessons is about lessons, and an
      // exam is in none of their counts (FR-E2).
      const examRows = lessons.filter((lesson) => lesson.kind === "exam");
      const lessonRows = lessons.filter((lesson) => lesson.kind !== "exam");

      const [strains, exams, pace] = await Promise.all([
        judgeLessons(tx, lessonRows),
        readExams(tx, examRows),
        readPace(tx, missionId, paceSince),
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
        lessons: lessonRows.map((lesson): LessonRow => ({
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
          strain: strains.get(lesson.id)!,
          adjustment:
            lesson.adjustment === "bridge" || lesson.adjustment === "harder"
              ? {
                  kind: lesson.adjustment,
                  reason: lesson.adjustment_reason,
                  bridgeForSlug: lesson.bridge_for_slug,
                }
              : null,
        })),
        exams,
        calendar:
          mission.weeks === null || mission.starts_on === null
            ? null
            : { weeks: mission.weeks, startsOn: mission.starts_on },
        pace,
      };
    });
  }
}

/**
 * Every exam with its items and every attempt at each (FR-E6).
 *
 * The items come from the exam's own `exercises` column, re-validated the way the
 * exercise panel does, so an item the reindexer could not have written is not an
 * item here either. Grading follows the kind: a `task` is the learner's word, and
 * everything else was checked by a test run or a review.
 */
async function readExams(
  tx: Tx,
  rows: readonly {
    id: string;
    track_id: string | null;
    title: string;
    seq: number | null;
    exercises: unknown;
  }[],
): Promise<readonly ExamRow[]> {
  if (rows.length === 0) return [];

  const attempts = await tx.$queryRawUnsafe<
    { lesson_id: string; exercise_key: string; passed: boolean; created_at: Date }[]
  >(
    `select lesson_id, exercise_key, passed, created_at from exercise_attempts
      where lesson_id = any($1::uuid[])`,
    rows.map((row) => row.id),
  );

  return rows.map((row) => {
    const declared = Array.isArray(row.exercises) ? row.exercises : [];
    const items = declared.flatMap((raw): ExamItemRow[] => {
      const parsed = ExerciseDeclarationSchema.safeParse(raw);
      if (!parsed.success) return [];
      const exercise = parsed.data;
      return [
        {
          key: exercise.key,
          covers: exercise.covers ?? [],
          // A task and a lab are the learner's word (FR-X10, FR-X12); everything else
          // was checked by a test run or a review.
          grading: exercise.kind === "task" || exercise.kind === "lab" ? "self" : "checked",
          attempts: attempts
            .filter((a) => a.lesson_id === row.id && a.exercise_key === exercise.key)
            .map((a) => ({ createdAt: a.created_at, passed: a.passed })),
        },
      ];
    });

    // An exam always has a file and so a seq (`lessons_generated_has_file`); 0 is
    // only a belt for a row written around that constraint.
    return { id: row.id, trackId: row.track_id, title: row.title, seq: row.seq ?? 0, items };
  });
}

/**
 * What the estimate is computed from (FR-U1).
 *
 * Minutes per session are floored the way `elapsedMinutes` floors them, so a lesson's
 * total here is the sum the time tracker would show, never a rounding up of it. A
 * session still running is not counted: it has no end, and its length is unknown
 * rather than "so far".
 */
async function readPace(tx: Tx, missionId: string, since: Date): Promise<PaceRows> {
  const [perLesson, [recent]] = await Promise.all([
    // Every mission's finished lessons, because how long a lesson takes this learner
    // is about them. RLS keeps it to their own rows.
    tx.$queryRawUnsafe<{ minutes: number }[]>(
      `select sum(floor(extract(epoch from (s.ended_at - s.started_at)) / 60))::int as minutes
         from lessons l join focus_sessions s on s.lesson_id = l.id and s.ended_at is not null
        where l.kind = 'lesson' and l.completed_at is not null
        group by l.id`,
    ),
    tx.$queryRawUnsafe<{ minutes: number | null }[]>(
      `select sum(floor(extract(epoch from (s.ended_at - s.started_at)) / 60))::int as minutes
         from focus_sessions s
        where s.ended_at is not null and s.started_at >= $2::timestamptz
          and (s.mission_id = $1::uuid
               or s.lesson_id in (select id from lessons where mission_id = $1::uuid))`,
      missionId,
      since,
    ),
  ]);

  return {
    lessonMinutes: perLesson.map((row) => row.minutes),
    recentMinutes: recent?.minutes ?? 0,
  };
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
