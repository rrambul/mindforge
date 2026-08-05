import {
  NOTE_LANGUAGES,
  NOTE_SUBJECTS,
  NoteLocatorSchema,
  type NoteLocator,
} from "@mindforge/core";
import type { RlsTransaction } from "@mindforge/db";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { Note, type NoteSnapshot } from "../domain/note.js";
import type { NoteFilter, NoteRepository } from "../domain/note.repository.js";

interface NoteRow {
  id: string;
  userId: string;
  body: string;
  subjectType: string;
  subjectId: string | null;
  quote: string | null;
  locator: unknown;
  pinned: boolean;
  lang: string;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS = {
  id: true,
  userId: true,
  body: true,
  subjectType: true,
  subjectId: true,
  quote: true,
  locator: true,
  pinned: true,
  lang: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class PrismaNoteRepository implements NoteRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  findById(userId: string, id: string): Promise<Note | null> {
    return this.db.run(userId, async (tx) => {
      const row = await tx.note.findUnique({ where: { id }, select: COLUMNS });
      return row ? toNote(row) : null;
    });
  }

  list(userId: string, filter: NoteFilter): Promise<Note[]> {
    return this.db.run(userId, async (tx) => {
      // Full-text search goes through raw SQL because Prisma cannot express a match against a
      // *generated* tsvector column, and that column is the whole point: it is stemmed per note by
      // its own language (FR-L4), which a LIKE could not reproduce.
      const ids = filter.q ? await searchIds(tx, filter) : null;
      if (ids !== null && ids.length === 0) return [];

      const rows = await tx.note.findMany({
        where: {
          ...(ids ? { id: { in: ids } } : {}),
          ...(filter.subjectType ? { subjectType: filter.subjectType } : {}),
          ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
          ...(filter.pinned === undefined ? {} : { pinned: filter.pinned }),
        },
        // Pinned first, then newest. Pinning is the only ordering signal a user can give, so it
        // outranks recency.
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        ...(filter.limit === undefined ? {} : { take: filter.limit }),
        select: COLUMNS,
      });

      return rows.map(toNote);
    });
  }

  async save(userId: string, note: Note): Promise<void> {
    const n = note.toSnapshot();

    const mutable = {
      body: n.body,
      quote: n.quote,
      pinned: n.pinned,
      updatedAt: n.updatedAt,
    };

    await this.db.run(userId, (tx) =>
      tx.note.upsert({
        where: { id: n.id },
        create: {
          id: n.id,
          userId: n.userId,
          subjectType: n.subjectType,
          subjectId: n.subjectId,
          // Spread rather than `locator: n.locator ?? undefined`: under
          // exactOptionalPropertyTypes, passing an explicit undefined to a Prisma Json field is a
          // different type from omitting it.
          ...(n.locator === null ? {} : { locator: n.locator }),
          lang: n.lang,
          createdAt: n.createdAt,
          ...mutable,
        },
        // `subjectType`, `subjectId`, `locator`, and `lang` are set once: a note does not migrate
        // between subjects, and re-stemming an edited note would change what it matches.
        update: mutable,
      }),
    );
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.db.run(userId, (tx) => tx.note.delete({ where: { id } }));
  }
}

/**
 * Ids matching the search, ranked by relevance.
 *
 * `websearch_to_tsquery` rather than `plainto_tsquery`: it understands quoted phrases and `-`
 * exclusion, which is what anyone typing into a search box expects, and it never throws on
 * malformed input — `plainto_tsquery` would turn a stray operator into a 500.
 *
 * The query is stemmed with each note's *own* configuration, matching how the column was built.
 */
async function searchIds(tx: RlsTransaction, filter: NoteFilter): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `select id
       from notes
      where search @@ websearch_to_tsquery(
              case lang when 'portuguese' then 'portuguese'::regconfig else 'english'::regconfig end,
              $1)
      order by ts_rank(search, websearch_to_tsquery(
              case lang when 'portuguese' then 'portuguese'::regconfig else 'english'::regconfig end,
              $1)) desc
      limit $2`,
    filter.q,
    filter.limit ?? 100,
  );
  return rows.map((row) => row.id);
}

function toNote(row: NoteRow): Note {
  return Note.fromSnapshot(toSnapshot(row));
}

function toSnapshot(row: NoteRow): NoteSnapshot {
  return {
    id: row.id,
    userId: row.userId,
    body: row.body,
    // Both are free-text columns with no check constraint. Narrowed at the one boundary where a row
    // becomes an entity rather than trusted.
    subjectType: narrow(row.subjectType, NOTE_SUBJECTS, "subject_type"),
    subjectId: row.subjectId,
    quote: row.quote,
    locator: toLocator(row.locator),
    pinned: row.pinned,
    lang: narrow(row.lang, NOTE_LANGUAGES, "lang"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A locator is JSONB, so it can hold anything. Parsed rather than cast, and a shape we do not
 * recognise degrades to null instead of throwing: a note whose locator went stale is still a note
 * worth reading, and losing the body over a bad page number would be the wrong trade.
 */
function toLocator(value: unknown): NoteLocator | null {
  if (value === null || value === undefined) return null;
  const parsed = NoteLocatorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function narrow<T extends string>(value: string, allowed: readonly T[], column: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`notes.${column} has unknown value "${value}"`);
  }
  return value as T;
}
