import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type {
  IndexedLesson,
  IndexedPlannedLesson,
  IndexedRecord,
  IndexedReferenceDoc,
  IndexedTrack,
  WorkspaceIndexRepository,
} from "../application/index.port.js";

/**
 * The index over a workspace's files.
 *
 * Every write is an upsert keyed on something the *file* determines — `seq` for
 * lessons and records, the path for reference docs — because reindexing has to
 * be idempotent: the same workspace parsed twice must produce the same rows, and
 * a second run re-reads every file it did not change.
 *
 * `on conflict … do update` rather than delete-then-insert, unlike
 * `workspace_files`. The difference is that these rows carry state the file does
 * not: `lessons.completed_at` and `outcome` come from the reader over
 * `postMessage` (§7.5), and deleting the row to rewrite it would throw away the
 * fact that somebody read the lesson. `workspace_files` has no such state, which
 * is why it can afford the simpler shape.
 */
@Injectable()
export class PrismaWorkspaceIndexRepository implements WorkspaceIndexRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  async saveTracks(
    userId: string,
    missionId: string,
    tracks: readonly IndexedTrack[],
  ): Promise<ReadonlyMap<string, string>> {
    const idBySlug = new Map<string, string>();

    await this.db.run(userId, async (tx) => {
      for (const track of tracks) {
        const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
          // `status` is written on insert only, except to revive a dropped track.
          // `CURRICULUM.md` has no status column — the same shape as `RESOURCES.md`
          // having no status column — so echoing one back would reset the module
          // the learner currently has open, on every run, forever.
          `insert into tracks (id, user_id, mission_id, slug, name, outcome, position,
             created_at, updated_at)
           values (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6::int, now(), now())
           on conflict (mission_id, slug) do update
             set name = excluded.name,
                 outcome = excluded.outcome,
                 position = excluded.position,
                 status = case when tracks.status = 'dropped' then 'proposed'
                               else tracks.status end,
                 updated_at = now()
           returning id`,
          userId,
          missionId,
          track.slug,
          track.name,
          track.outcome,
          track.position,
        );
        idBySlug.set(track.slug, rows[0]!.id);
      }

      const present = tracks.map((track) => track.slug);

      // Marked, never deleted — and only when the file listed something, so an
      // empty parse cannot wipe a curriculum.
      if (present.length > 0) {
        await tx.$executeRawUnsafe(
          `update tracks set status = 'dropped', updated_at = now()
            where mission_id = $1::uuid and slug <> all($2::text[]) and status <> 'dropped'`,
          missionId,
          present,
        );
      }

      // Edges are rebuilt rather than upserted: unlike a track, an edge carries
      // no state the file does not have, and a prerequisite the curriculum
      // removed has to actually go.
      const ids = [...idBySlug.values()];
      if (ids.length > 0) {
        await tx.$executeRawUnsafe(`delete from track_edges where track_id = any($1::uuid[])`, ids);
      }

      for (const track of tracks) {
        const trackId = idBySlug.get(track.slug)!;

        for (const prereqSlug of track.prerequisiteSlugs) {
          const prereqId = idBySlug.get(prereqSlug);
          // Resolved after every track exists, for the same reason `saveRecords`
          // needs two passes: a track may require one listed below it, and the
          // order column is a reading recommendation rather than a sort.
          if (prereqId === undefined || prereqId === trackId) continue;
          await tx.$executeRawUnsafe(
            `insert into track_edges (user_id, track_id, prereq_id)
             values ($1::uuid, $2::uuid, $3::uuid) on conflict do nothing`,
            userId,
            trackId,
            prereqId,
          );
        }
      }
    });

    return idBySlug;
  }

  async trackIdsBySlug(userId: string, missionId: string): Promise<ReadonlyMap<string, string>> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<{ id: string; slug: string }[]>(
        `select id, slug from tracks where mission_id = $1::uuid`,
        missionId,
      ),
    );

    return new Map(rows.map((row) => [row.slug, row.id]));
  }

  async savePlannedLessons(
    userId: string,
    missionId: string,
    lessons: readonly IndexedPlannedLesson[],
  ): Promise<void> {
    if (lessons.length === 0) return;

    // Only the modules this parse actually contained. The plan is regenerated
    // wholesale and a run can stop halfway through writing it, so silence about a
    // module is not a decision about it.
    const trackIds = [...new Set(lessons.map((lesson) => lesson.trackId))];
    const idBySlug = new Map<string, string>();

    await this.db.run(userId, async (tx) => {
      for (const lesson of lessons) {
        // Looked up rather than inferred from `on conflict`, because the index
        // that owns the slug is partial: once a lesson has been written from a
        // plan entry the row leaves it, and an upsert would then insert a second
        // row for a slug that already has one. Ordered so the plan entry wins
        // over the legal duplicate case — two written lessons may share a
        // filename slug, and the earlier one is the one a plan entry became.
        const existing = await tx.$queryRawUnsafe<{ id: string }[]>(
          `select id from lessons
            where mission_id = $1::uuid and slug = $2
            order by (status = 'planned') desc, seq asc nulls first
            limit 1`,
          missionId,
          lesson.slug,
        );

        if (existing.length === 0) {
          const inserted = await tx.$queryRawUnsafe<{ id: string }[]>(
            `insert into lessons (id, user_id, mission_id, track_id, status, slug, title, intent,
               difficulty, depth, position, created_at, updated_at)
             values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'planned', $4, $5, $6,
                     $7::smallint, $8, $9::smallint, now(), now())
             returning id`,
            userId,
            missionId,
            lesson.trackId,
            lesson.slug,
            lesson.title,
            lesson.intent,
            lesson.difficulty,
            lesson.depth,
            lesson.position,
          );
          idBySlug.set(lesson.slug, inserted[0]!.id);
          continue;
        }

        await tx.$executeRawUnsafe(
          // `title` and `track_id` move only while the row is still a plan. Once
          // there is a file, the file is what the lesson is (non-negotiable 5) and
          // its `<meta name="mindforge:track">` is where it lives — a regenerated
          // curriculum must not rename a lesson somebody has read.
          `update lessons
              set intent = $2,
                  difficulty = $3::smallint,
                  depth = $4,
                  position = $5::smallint,
                  title = case when status = 'planned' then $6 else title end,
                  track_id = case when status = 'planned' then $7::uuid else track_id end,
                  updated_at = now()
            where id = $1::uuid`,
          existing[0]!.id,
          lesson.intent,
          lesson.difficulty,
          lesson.depth,
          lesson.position,
          lesson.title,
          lesson.trackId,
        );
        idBySlug.set(lesson.slug, existing[0]!.id);
      }

      // Dropped from the plan and never written: nothing is lost that the file
      // cannot say again, and a stale row would be counted forever in a module
      // fraction it no longer belongs to.
      await tx.$executeRawUnsafe(
        `delete from lessons
          where mission_id = $1::uuid and status = 'planned'
            and track_id = any($2::uuid[]) and slug <> all($3::text[])`,
        missionId,
        trackIds,
        lessons.map((lesson) => lesson.slug),
      );

      // Rebuilt, not upserted: an edge carries no state the file does not have,
      // and a dependency the curriculum removed has to actually go. Scoped to the
      // modules in this parse, so an edge written by a module it never reached
      // survives.
      await tx.$executeRawUnsafe(
        `delete from lesson_edges
          where lesson_id in (select id from lessons where track_id = any($1::uuid[]))`,
        trackIds,
      );

      for (const lesson of lessons) {
        const lessonId = idBySlug.get(lesson.slug)!;

        for (const prereqSlug of lesson.prerequisiteSlugs) {
          const prereqId = idBySlug.get(prereqSlug);
          if (prereqId === undefined || prereqId === lessonId) continue;
          await tx.$executeRawUnsafe(
            `insert into lesson_edges (user_id, lesson_id, prereq_id)
             values ($1::uuid, $2::uuid, $3::uuid) on conflict do nothing`,
            userId,
            lessonId,
            prereqId,
          );
        }
      }
    });
  }

  async saveLessons(userId: string, lessons: readonly IndexedLesson[]): Promise<void> {
    if (lessons.length === 0) return;

    await this.db.run(userId, async (tx) => {
      for (const lesson of lessons) {
        // The plan entry this file claims stops being an intention and becomes the
        // file: same row, same id, so its intent, its difficulty and every edge
        // pointing at it survive. `(mission_id, seq)` cannot express this — the
        // planned row has no seq to conflict on — so the claim is its own update,
        // and the insert below only runs when nothing was claimed.
        const claimed =
          lesson.planSlug === null
            ? 0
            : await tx.$executeRawUnsafe(
                `update lessons
                    set status = 'generated',
                        track_id = $3::uuid,
                        seq = $4::int,
                        title = $5,
                        storage_path = $6,
                        content_hash = $7,
                        updated_at = now()
                  where mission_id = $1::uuid and slug = $2 and status = 'planned'`,
                lesson.missionId,
                lesson.planSlug,
                lesson.trackId,
                lesson.seq,
                lesson.title,
                lesson.storagePath,
                lesson.contentHash,
              );

        if (claimed > 0) continue;

        await tx.$executeRawUnsafe(
          `insert into lessons (id, user_id, mission_id, track_id, seq, slug, title, storage_path,
             content_hash, created_at, updated_at)
           values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::int, $5, $6, $7, $8,
                   now(), now())
           on conflict (mission_id, seq) do update
             set track_id = excluded.track_id,
                 slug = excluded.slug,
                 title = excluded.title,
                 storage_path = excluded.storage_path,
                 content_hash = excluded.content_hash,
                 updated_at = now()`,
          userId,
          lesson.missionId,
          lesson.trackId,
          lesson.seq,
          // The plan's slug wins over the filename's when the file claims one, on
          // the insert as well as on the claim. It is what the plan looks the row
          // up by, so a lesson whose file was renamed — or whose row was rebuilt
          // from Storage — re-attaches to its plan entry instead of quietly
          // becoming a second lesson beside it.
          lesson.planSlug ?? lesson.slug,
          lesson.title,
          lesson.storagePath,
          lesson.contentHash,
        );
      }
    });
  }

  async saveReferenceDocs(userId: string, docs: readonly IndexedReferenceDoc[]): Promise<void> {
    if (docs.length === 0) return;

    await this.db.run(userId, async (tx) => {
      for (const doc of docs) {
        await tx.$executeRawUnsafe(
          `insert into reference_docs (id, user_id, mission_id, slug, title, storage_path,
             content_hash, created_at, updated_at)
           values (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6, now(), now())
           on conflict (mission_id, storage_path) do update
             set slug = excluded.slug,
                 title = excluded.title,
                 content_hash = excluded.content_hash,
                 updated_at = now()`,
          userId,
          doc.missionId,
          doc.slug,
          doc.title,
          doc.storagePath,
          doc.contentHash,
        );
      }
    });
  }

  async saveRecords(userId: string, records: readonly IndexedRecord[]): Promise<void> {
    if (records.length === 0) return;

    await this.db.run(userId, async (tx) => {
      // Two passes. A record can supersede one this same run created, so there is
      // no id to point at until every row exists — resolving in one pass would
      // silently drop the link on exactly the case supersession is for: a
      // correction written alongside what it corrects.
      for (const record of records) {
        await tx.$executeRawUnsafe(
          `insert into learning_records (id, user_id, mission_id, seq, title, what_learned,
             evidence, key_insight, struggles, next, storage_path, content_hash, recorded_at)
           values (gen_random_uuid(), $1::uuid, $2::uuid, $3::int, $4, $5, $6, $7, $8, $9, $10,
                   $11, $12::timestamptz)
           on conflict (mission_id, seq) do update
             set title = excluded.title,
                 what_learned = excluded.what_learned,
                 evidence = excluded.evidence,
                 key_insight = excluded.key_insight,
                 struggles = excluded.struggles,
                 next = excluded.next,
                 storage_path = excluded.storage_path,
                 content_hash = excluded.content_hash,
                 recorded_at = excluded.recorded_at`,
          userId,
          record.missionId,
          record.seq,
          record.title,
          record.whatLearned,
          record.evidence,
          record.keyInsight,
          record.struggles,
          record.next,
          record.storagePath,
          record.contentHash,
          record.recordedAt,
        );
      }

      for (const record of records) {
        if (record.supersedesSeq === null) continue;
        await tx.$executeRawUnsafe(
          // Scoped to the same mission: a `0007-…` link means this mission's
          // seventh record, and records do not cross missions.
          `update learning_records
              set supersedes_id = (
                select id from learning_records
                 where mission_id = $2::uuid and seq = $3::int
              )
            where mission_id = $2::uuid and seq = $1::int`,
          record.seq,
          record.missionId,
          record.supersedesSeq,
        );
      }
    });
  }

  async forgetPaths(userId: string, missionId: string, paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;

    await this.db.run(userId, async (tx) => {
      // Rows only. The files are already gone from Storage, and these tables are
      // an index over what is there — a lesson row pointing at a path that no
      // longer exists is a library entry that 404s.
      await tx.$executeRawUnsafe(
        `delete from lessons where mission_id = $1::uuid and storage_path = any($2::text[])`,
        missionId,
        [...paths],
      );
      await tx.$executeRawUnsafe(
        `delete from reference_docs where mission_id = $1::uuid and storage_path = any($2::text[])`,
        missionId,
        [...paths],
      );
      await tx.$executeRawUnsafe(
        `delete from learning_records where mission_id = $1::uuid and storage_path = any($2::text[])`,
        missionId,
        [...paths],
      );
    });
  }
}
