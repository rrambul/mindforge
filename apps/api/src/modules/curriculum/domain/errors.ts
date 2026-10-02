import { DomainError, type DomainErrorKind, type ServerMessageKey } from "@mindforge/core";

/**
 * What committing to a deadline refuses (FR-U2).
 *
 * Each names a `kind` rather than a status code — `shared/http` turns that into
 * HTTP (§2.1).
 */

/**
 * The module is not one this mission's curriculum shows. `not_found`, like a lesson
 * that is not yours: RLS makes "not yours" and "does not exist" one observation.
 */
export class ModuleNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "module-not-found";
  readonly detailKey: ServerMessageKey = "error.deadline.module_not_found";

  constructor(id: string) {
    super(`Module ${id} is not in this curriculum`);
  }
}

/**
 * A dropped module is shown for its finished lessons and is no longer part of the
 * plan. A deadline on it would be a promise about work the curriculum abandoned.
 */
export class ModuleDropped extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "module-dropped";
  readonly detailKey: ServerMessageKey = "error.deadline.module_dropped";

  constructor(id: string) {
    super(`Module ${id} was dropped from the curriculum`);
  }
}

/**
 * A finished module has nothing left to be due. Moving its date afterwards would
 * turn "missed by three days" into "met" — the one edit the append-only history
 * exists to make impossible.
 */
export class ModuleFinished extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "module-finished";
  readonly detailKey: ServerMessageKey = "error.deadline.module_finished";

  constructor(id: string) {
    super(`Module ${id} is finished`);
  }
}

/** A commitment is to a day still ahead, in the learner's own timezone (FR-U6). */
export class DeadlineInPast extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "deadline-in-past";
  readonly detailKey: ServerMessageKey = "error.deadline.in_past";

  constructor(dueOn: string, today: string) {
    super(`Deadline ${dueOn} is before today, ${today}`);
  }
}
