import type { NoteSubject } from "@mindforge/core";
import type { Note } from "./note.js";

export const NOTE_REPOSITORY = Symbol("NoteRepository");

export interface NoteFilter {
  readonly subjectType?: NoteSubject | undefined;
  readonly subjectId?: string | undefined;
  /** Free text, matched against the generated tsvector (FR-N6). */
  readonly q?: string | undefined;
  readonly pinned?: boolean | undefined;
  readonly limit?: number | undefined;
}

export interface NoteRepository {
  findById(userId: string, id: string): Promise<Note | null>;
  list(userId: string, filter: NoteFilter): Promise<Note[]>;
  /** Upsert, so a replayed capture converges on one note rather than two (§6.1). */
  save(userId: string, note: Note): Promise<void>;
  delete(userId: string, id: string): Promise<void>;
}
