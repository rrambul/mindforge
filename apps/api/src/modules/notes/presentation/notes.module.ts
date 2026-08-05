import { Module } from "@nestjs/common";
import { DeleteNote, EditNote, ListNotes, WriteNote } from "../application/note.use-cases.js";
import { NOTE_REPOSITORY } from "../domain/note.repository.js";
import { PrismaNoteRepository } from "../infrastructure/prisma-note.repository.js";
import { NotesController } from "./notes.controller.js";

/**
 * `WriteNote` is exported because the teach worker will summarise notes into the agent's briefing
 * (FR-N5) and sync them into the workspace as Markdown (FR-N8) — both through this command rather
 * than a second write path.
 */
@Module({
  controllers: [NotesController],
  providers: [
    WriteNote,
    EditNote,
    ListNotes,
    DeleteNote,
    { provide: NOTE_REPOSITORY, useClass: PrismaNoteRepository },
  ],
  exports: [WriteNote, ListNotes],
})
export class NotesModule {}
