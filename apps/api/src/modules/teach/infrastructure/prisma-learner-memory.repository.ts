import type { MemoryKind } from "@mindforge/workspace";
import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type {
  IndexedMemory,
  LearnerMemoryRepository,
  LearnerMemoryView,
} from "../application/memory.port.js";

interface Row {
  id: string;
  slug: string;
  kind: string;
  summary: string;
  written_by: string;
  confirmed_at: Date | null;
  superseded_slug: string | null;
  updated_at: Date;
}

function toView(row: Row): LearnerMemoryView {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind as MemoryKind,
    summary: row.summary,
    writtenBy: row.written_by,
    confirmedAt: row.confirmed_at,
    supersededBySlug: row.superseded_slug,
    updatedAt: row.updated_at,
  };
}

const VIEW_COLUMNS = `m.id, m.slug, m.kind, m.summary, m.written_by, m.confirmed_at,
                      m.updated_at, r.slug as superseded_slug`;

@Injectable()
export class PrismaLearnerMemoryRepository implements LearnerMemoryRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  async saveFromAgent(userId: string, memories: readonly IndexedMemory[]): Promise<void> {
    if (memories.length === 0) return;

    await this.db.run(userId, async (tx) => {
      for (const memory of memories) {
        await tx.$executeRawUnsafe(
          // `written_by` and `confirmed_at` are absent from the update list on
          // purpose. A run must not be able to mark its own inference as
          // user-confirmed, and a memory the learner typed stays theirs even when
          // the agent later rewrites the file underneath it.
          `insert into learner_memories (id, user_id, slug, kind, summary, storage_path,
             content_hash, written_by, created_at, updated_at)
           values (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, 'agent', now(), now())
           on conflict (user_id, slug) do update
             set kind = excluded.kind,
                 summary = excluded.summary,
                 storage_path = excluded.storage_path,
                 content_hash = excluded.content_hash,
                 updated_at = now()`,
          userId,
          memory.slug,
          memory.kind,
          memory.summary,
          memory.storagePath,
          memory.contentHash,
        );
      }
    });
  }

  async markSuperseded(
    userId: string,
    supersededSlug: string,
    replacementSlug: string,
  ): Promise<boolean> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(
        // A subselect rather than two round trips, so a replacement written in the
        // same run — which is the case supersession exists for — resolves without
        // ordering the writes.
        // No `user_id` in the predicate and no `$` for it either: `db.run` already
        // scoped this to the user through RLS, and a placeholder the statement
        // never references is one Postgres cannot infer a type for (42P18).
        `update learner_memories
            set superseded_by = (select id from learner_memories where slug = $2),
                updated_at = now()
          where slug = $1
            and exists (select 1 from learner_memories where slug = $2)
          returning id`,
        supersededSlug,
        replacementSlug,
      ),
    );
    return rows.length > 0;
  }

  async list(userId: string): Promise<readonly LearnerMemoryView[]> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<Row[]>(
        // Superseded ones are returned too, and last. §7.6: that a stated
        // preference changed is itself the information, so hiding the old entry
        // would hide the change.
        `select ${VIEW_COLUMNS}
           from learner_memories m
           left join learner_memories r on r.id = m.superseded_by
          order by (m.superseded_by is not null), m.updated_at desc`,
      ),
    );
    return rows.map(toView);
  }

  async confirm(userId: string, id: string): Promise<LearnerMemoryView | null> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<Row[]>(
        // Selected **from the CTE**, not from the table. Every part of a statement
        // sees the same snapshot, so a sibling `select` against
        // `learner_memories` reads the row as it was before the update and reports
        // `confirmed_at` as null — a confirm that silently appears not to have
        // worked. The join to `r` is against the base table because a
        // supersession is another row and did not change here.
        `with confirmed as (
           update learner_memories set confirmed_at = now(), updated_at = now()
            where id = $1::uuid
            returning *
         )
         select ${VIEW_COLUMNS}
           from confirmed m
           left join learner_memories r on r.id = m.superseded_by`,
        id,
      ),
    );
    return rows[0] ? toView(rows[0]) : null;
  }

  async forget(userId: string, id: string): Promise<{ storagePath: string } | null> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<{ storage_path: string }[]>(
        // The path comes back so the caller can delete the file too. The row
        // alone would leave the memory in Storage, where the next run
        // materialises it and re-indexes it — a delete that undoes itself.
        `delete from learner_memories where id = $1::uuid returning storage_path`,
        id,
      ),
    );
    return rows[0] ? { storagePath: rows[0].storage_path } : null;
  }
}
