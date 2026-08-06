import {
  noteLanguageFor,
  type CreateNoteInput,
  type ListNotesQuery,
  type UpdateNoteInput,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { ID_GENERATOR, type IdGenerator } from "../../../shared/ids/id-generator.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { NoteNotFound } from "../domain/errors.js";
import { Note } from "../domain/note.js";
import { NOTE_REPOSITORY, type NoteRepository } from "../domain/note.repository.js";

/**
 * FR-N1, FR-N3 — a note on anything, one tap from wherever you are.
 *
 * The subject comes from the *caller*, never from a picker: the route knows a session is running, so
 * "note on this session" needs no question asked. §6.14 is explicit — no picker, no filing.
 *
 * Idempotent on a client id like every other capture path, so the offline queue can carry notes too.
 */
@Injectable()
export class WriteNote {
  constructor(
    @Inject(NOTE_REPOSITORY) private readonly notes: NoteRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(
    userId: string,
    input: CreateNoteInput,
    /**
     * The profile's *content* language, not its UI locale (§5.2's third axis). A pt-BR interface
     * with English notes is a likely combination, and the stemmer has to follow the writing.
     */
    contentLanguage: string,
  ): Promise<Note> {
    if (input.id) {
      const existing = await this.notes.findById(userId, input.id);
      if (existing) return existing;
    }

    const note = Note.write({
      id: input.id ?? this.ids.next(),
      userId,
      body: input.body,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      quote: input.quote ?? null,
      locator: input.locator ?? null,
      pinned: input.pinned,
      // Derived when the client did not say, honoured when it did. The writer should not have to
      // declare a language, and the profile's content language is the best available guess — but a
      // share-target or an importer knows the language of what it is carrying better than the profile
      // does, and saying "english" has to mean English.
      lang: input.lang ?? noteLanguageFor(contentLanguage),
      now: this.clock.now(),
    });

    await this.notes.save(userId, note);
    return note;
  }
}

@Injectable()
export class EditNote {
  constructor(
    @Inject(NOTE_REPOSITORY) private readonly notes: NoteRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, id: string, input: UpdateNoteInput): Promise<Note> {
    const note = await this.notes.findById(userId, id);
    if (!note) throw new NoteNotFound(id);

    note.edit(
      {
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.quote === undefined ? {} : { quote: input.quote }),
        ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
      },
      this.clock.now(),
    );

    await this.notes.save(userId, note);
    return note;
  }
}

/**
 * Notes are the one M1 list with no natural bound — a year of thinking is thousands of rows — so it
 * is capped, and search rather than scrolling is the retrieval story (FR-N6).
 */
const DEFAULT_LIMIT = 100;

@Injectable()
export class ListNotes {
  constructor(@Inject(NOTE_REPOSITORY) private readonly notes: NoteRepository) {}

  execute(userId: string, query: ListNotesQuery): Promise<Note[]> {
    return this.notes.list(userId, { ...query, limit: DEFAULT_LIMIT });
  }
}

@Injectable()
export class DeleteNote {
  constructor(@Inject(NOTE_REPOSITORY) private readonly notes: NoteRepository) {}

  async execute(userId: string, id: string): Promise<void> {
    // Read first so deleting something that is not there is a 404 rather than a silent success —
    // a delete that reports success for a note you do not own would be a confusing way to discover
    // RLS is working.
    const note = await this.notes.findById(userId, id);
    if (!note) throw new NoteNotFound(id);
    await this.notes.delete(userId, id);
  }
}
