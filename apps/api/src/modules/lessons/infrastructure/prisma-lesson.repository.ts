import { asLessonOutcome, type LessonDepth, type LessonOutcome } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { LessonRecord, LessonRepository } from "../domain/lesson.repository.js";

interface LessonQueryRow {
  readonly id: string;
  readonly mission_id: string;
  readonly track_id: string | null;
  readonly module_name: string | null;
  readonly slug: string;
  readonly title: string;
  readonly intent: string | null;
  readonly status: string;
  readonly difficulty: number | null;
  readonly depth: LessonDepth | null;
  readonly seq: number | null;
  readonly storage_path: string | null;
  readonly workspace_key: string | null;
  readonly completed_at: Date | null;
  readonly outcome: string | null;
}

/**
 * The reader's one row.
 *
 * Joined to `missions` for the workspace key and left-joined to `tracks` for the
 * module's name: the reader's chrome says which module you are in, and a second
 * round trip for one string would be a second round trip on every lesson opened.
 */
@Injectable()
export class PrismaLessonRepository implements LessonRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  findById(userId: string, id: string): Promise<LessonRecord | null> {
    return this.db.run(userId, async (tx) => {
      const [row] = await tx.$queryRawUnsafe<LessonQueryRow[]>(
        `select l.id, l.mission_id, l.track_id, t.name as module_name, l.slug, l.title, l.intent,
                l.status, l.difficulty, l.depth, l.seq, l.storage_path, m.workspace_key,
                l.completed_at, l.outcome
           from lessons l
           join missions m on m.id = l.mission_id
           left join tracks t on t.id = l.track_id
          where l.id = $1::uuid`,
        id,
      );

      return row === undefined ? null : toRecord(row);
    });
  }

  async setCompletion(
    userId: string,
    id: string,
    completion: { readonly completedAt: Date; readonly outcome: LessonOutcome } | null,
  ): Promise<void> {
    await this.db.run(userId, (tx) =>
      tx.$executeRawUnsafe(
        `update lessons set completed_at = $2::timestamptz, outcome = $3, updated_at = now()
          where id = $1::uuid`,
        id,
        completion?.completedAt ?? null,
        completion?.outcome ?? null,
      ),
    );
  }
}

function toRecord(row: LessonQueryRow): LessonRecord {
  return {
    id: row.id,
    missionId: row.mission_id,
    trackId: row.track_id,
    moduleName: row.module_name,
    slug: row.slug,
    title: row.title,
    intent: row.intent,
    // Narrowed rather than cast, like the curriculum reader: the column is CHECKed
    // to these two, and a third would be a migration nobody told this file about.
    status: row.status === "planned" ? "planned" : "generated",
    difficulty: row.difficulty,
    depth: row.depth,
    seq: row.seq,
    storagePath: row.storage_path,
    workspaceKey: row.workspace_key,
    completedAt: row.completed_at,
    outcome: asLessonOutcome(row.outcome),
  };
}
