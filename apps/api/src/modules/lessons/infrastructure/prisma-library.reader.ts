import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type {
  LearningRecordRow,
  LibraryReader,
  MissionLibrary,
} from "../application/library.port.js";

/**
 * The two collections a workspace leaves behind, read under RLS.
 *
 * Both start by asking for the mission itself. That query is the ownership test —
 * a mission that is not this user's returns no row, and the caller turns that into
 * the same 404 as one that never existed. Without it an empty list would answer
 * both "you have no reference docs" and "that mission is somebody else's", and
 * only one of those is true.
 */
@Injectable()
export class PrismaLibraryReader implements LibraryReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  referenceDocs(userId: string, missionId: string): Promise<MissionLibrary | null> {
    return this.db.run(userId, async (tx) => {
      const [mission] = await tx.$queryRawUnsafe<{ workspace_key: string | null }[]>(
        `select workspace_key from missions where id = $1::uuid`,
        missionId,
      );
      if (mission === undefined) return null;

      const rows = await tx.$queryRawUnsafe<
        {
          id: string;
          slug: string;
          title: string;
          storage_path: string;
          updated_at: Date;
        }[]
      >(
        `select id, slug, title, storage_path, updated_at from reference_docs
          where mission_id = $1::uuid order by title`,
        missionId,
      );

      return {
        workspaceKey: mission.workspace_key,
        referenceDocs: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          storagePath: row.storage_path,
          updatedAt: row.updated_at,
        })),
      };
    });
  }

  learningRecords(
    userId: string,
    missionId: string,
    lessonId?: string,
  ): Promise<readonly LearningRecordRow[] | null> {
    return this.db.run(userId, async (tx) => {
      const [mission] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `select id from missions where id = $1::uuid`,
        missionId,
      );
      if (mission === undefined) return null;

      // `$2::uuid is null or …` rather than two queries: one statement, one plan,
      // and no branch in which the mission filter could be forgotten.
      const rows = await tx.$queryRawUnsafe<
        {
          id: string;
          seq: number;
          title: string;
          lesson_id: string | null;
          lesson_title: string | null;
          what_learned: string;
          evidence: string | null;
          key_insight: string | null;
          struggles: string | null;
          next: string | null;
          recorded_at: Date;
        }[]
      >(
        `select r.id, r.seq, r.title, r.lesson_id, l.title as lesson_title, r.what_learned,
                r.evidence, r.key_insight, r.struggles, r.next, r.recorded_at
           from learning_records r
           left join lessons l on l.id = r.lesson_id
          where r.mission_id = $1::uuid
            and ($2::uuid is null or r.lesson_id = $2::uuid)
          order by r.recorded_at desc, r.seq desc`,
        missionId,
        lessonId ?? null,
      );

      return rows.map((row) => ({
        id: row.id,
        seq: row.seq,
        title: row.title,
        lessonId: row.lesson_id,
        lessonTitle: row.lesson_title,
        whatLearned: row.what_learned,
        evidence: row.evidence,
        keyInsight: row.key_insight,
        struggles: row.struggles,
        next: row.next,
        recordedAt: row.recorded_at,
      }));
    });
  }
}
