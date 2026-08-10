import { DomainError, type DomainErrorKind, type ServerMessageKey } from "@mindforge/core";

/**
 * What the reader refuses to do.
 *
 * Each names a `kind` rather than a status code — `shared/http` turns that into
 * HTTP, so this file has no idea what a 409 is (§2.1).
 */

/**
 * The lesson id is not one of yours.
 *
 * `not_found` rather than `forbidden`, for the reason `MissionNotFound` gives: RLS
 * makes "not yours" and "does not exist" the same observation, and distinguishing
 * them would confirm that some other user owns this id.
 */
export class LessonNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "lesson-not-found";
  readonly detailKey: ServerMessageKey = "error.lesson.not_found";

  constructor(id: string) {
    super(`Lesson ${id} not found`);
  }
}

/**
 * A planned lesson has no file, so there is nothing to open and nothing to have
 * understood.
 *
 * `conflict` rather than `invalid`: the id is real and it is yours, and the fix is
 * to have the lesson written rather than to correct a field. The database says the
 * same thing one layer down (`lessons_planned_not_completed`), and it is said here
 * so the answer is a 409 the SPA can turn into "teach me this first" rather than a
 * 500 from a constraint nobody was expecting to meet.
 */
export class LessonNotWritten extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "lesson-not-written";
  readonly detailKey: ServerMessageKey = "error.lesson.not_written";

  constructor(id: string) {
    super(`Lesson ${id} is planned and has no content yet`);
  }
}
