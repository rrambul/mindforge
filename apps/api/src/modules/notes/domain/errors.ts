import { DomainError, type DomainErrorKind, type ServerMessageKey } from "@mindforge/core";

export class NoteNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "note-not-found";
  readonly detailKey: ServerMessageKey = "error.note.not_found";

  constructor(id: string) {
    // RLS makes "not yours" and "does not exist" indistinguishable here, which is the right answer.
    super(`Note ${id} not found`);
  }
}
