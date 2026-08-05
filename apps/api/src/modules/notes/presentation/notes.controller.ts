import {
  CreateNoteSchema,
  ListNotesQuerySchema,
  UpdateNoteSchema,
  UuidSchema,
  type CreateNoteInput,
  type ListNotesQuery,
  type NoteLanguage,
  type NoteLocator,
  type NoteSubject,
  type UpdateNoteInput,
} from "@mindforge/core";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import { DeleteNote, EditNote, ListNotes, WriteNote } from "../application/note.use-cases.js";
import type { Note } from "../domain/note.js";

export interface NoteView {
  readonly id: string;
  readonly body: string;
  readonly subjectType: NoteSubject;
  readonly subjectId: string | null;
  readonly quote: string | null;
  readonly locator: NoteLocator | null;
  /** Derived, not stored: a note with a quote is a highlight (FR-N2). */
  readonly isHighlight: boolean;
  readonly pinned: boolean;
  readonly lang: NoteLanguage;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toView(note: Note): NoteView {
  const n = note.toSnapshot();
  return {
    id: n.id,
    body: n.body,
    subjectType: n.subjectType,
    subjectId: n.subjectId,
    quote: n.quote,
    locator: n.locator,
    isHighlight: note.isHighlight,
    pinned: n.pinned,
    lang: n.lang,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

/**
 * `/v1/notes` (§6.14).
 *
 * A capture endpoint like friction, so it takes a client-generated id and upserts (§6.1). What it
 * deliberately does *not* have is any way to ask which subject a note belongs to — the caller
 * already knows, because it is the screen you were on. §6.14: no picker, no filing.
 */
@Controller("notes")
export class NotesController {
  constructor(
    private readonly write: WriteNote,
    private readonly edit: EditNote,
    private readonly list: ListNotes,
    private readonly remove: DeleteNote,
  ) {}

  @Get()
  async listNotes(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(ListNotesQuerySchema)) query: ListNotesQuery,
  ): Promise<{ notes: NoteView[] }> {
    const notes = await this.list.execute(user.userId, query);
    return { notes: notes.map(toView) };
  }

  @Post()
  async create(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(CreateNoteSchema)) body: CreateNoteInput,
  ): Promise<NoteView> {
    // The content language comes from the profile, not the request: it decides which stemmer the
    // generated search column uses (FR-L4), and a client guess would make search silently worse.
    return toView(await this.write.execute(user.userId, body, user.locale));
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(UpdateNoteSchema)) body: UpdateNoteInput,
  ): Promise<NoteView> {
    return toView(await this.edit.execute(user.userId, id, body));
  }

  @Delete(":id")
  @HttpCode(204)
  async destroy(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<void> {
    await this.remove.execute(user.userId, id);
  }
}
