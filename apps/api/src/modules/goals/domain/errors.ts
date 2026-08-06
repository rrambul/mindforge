import {
  DomainError,
  type DomainErrorKind,
  type FieldViolation,
  type ServerMessageKey,
} from "@mindforge/core";

export class GoalNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "goal-not-found";
  readonly detailKey: ServerMessageKey = "error.goal.not_found";

  constructor(id: string) {
    super(`Goal ${id} not found`);
  }
}

export class GoalTargetNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "goal-target-not-found";
  readonly detailKey: ServerMessageKey = "error.goal.target_not_found";

  constructor(id: string) {
    super(`Goal target ${id} not found`);
  }
}

/**
 * A closed goal is a decision, not a state to be edited around.
 *
 * Reopening exists (`PATCH /:id/reopen`) and is deliberately a separate, explicit act — so a stray
 * edit cannot quietly resurrect something you decided to stop, and the history says which happened.
 */
export class GoalAlreadyClosed extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "goal-already-closed";
  readonly detailKey: ServerMessageKey = "error.goal.already_closed";

  constructor(id: string, status: string) {
    super(`Goal ${id} is already ${status}`);
  }
}

export class GoalNotClosed extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "goal-not-closed";
  readonly detailKey: ServerMessageKey = "error.goal.not_closed";

  constructor(id: string) {
    super(`Goal ${id} is still active`);
  }
}

/**
 * Only a `manual` target can be set by hand (§3.8).
 *
 * The one rule the whole feature protects: every other kind is computed from evidence, and a hand-set
 * `resource_progress` would be a self-reported number sitting in a field the UI renders as measured.
 */
export class TargetNotManual extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "target-not-manual";
  readonly detailKey: ServerMessageKey = "error.goal.target_not_manual";

  constructor(kind: string) {
    super(`A ${kind} target is computed, not set`);
  }
}

/**
 * A target pointing at something that is not there.
 *
 * Checked rather than left to the foreign key, because the constraint violation arrives as a driver
 * error that becomes a 500 — and "that resource no longer exists" is an ordinary thing for a client
 * to be told.
 */
export class TargetSubjectMissing extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "target-subject-missing";
  readonly detailKey: ServerMessageKey = "error.goal.subject_missing";
  override readonly detailVars: { readonly subject: string };
  override readonly violations: readonly FieldViolation[];

  constructor(subject: "resource" | "skill" | "mission", id: string) {
    super(`No ${subject} ${id}`);
    this.detailVars = { subject };
    this.violations = [{ field: `${subject}Id`, code: "not_found", message: this.message }];
  }
}
