import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type {
  IndexedLesson,
  IndexedRecord,
  IndexedReferenceDoc,
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

  async saveLessons(userId: string, lessons: readonly IndexedLesson[]): Promise<void> {
    if (lessons.length === 0) return;

    await this.db.run(userId, async (tx) => {
      for (const lesson of lessons) {
        await tx.$executeRawUnsafe(
          `insert into lessons (id, user_id, mission_id, seq, slug, title, storage_path,
             content_hash, created_at, updated_at)
           values (gen_random_uuid(), $1::uuid, $2::uuid, $3::int, $4, $5, $6, $7, now(), now())
           on conflict (mission_id, seq) do update
             set slug = excluded.slug,
                 title = excluded.title,
                 storage_path = excluded.storage_path,
                 content_hash = excluded.content_hash,
                 updated_at = now()`,
          userId,
          lesson.missionId,
          lesson.seq,
          lesson.slug,
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
