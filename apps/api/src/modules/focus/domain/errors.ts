import {
  DomainError,
  type DomainErrorKind,
  type FieldViolation,
  type ServerMessageKey,
} from "@mindforge/core";

export class FocusSessionNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "focus-session-not-found";
  readonly detailKey: ServerMessageKey = "error.focus.not_found";

  constructor(id: string) {
    // RLS makes "not yours" and "does not exist" the same observation, which is the right
    // answer to give — distinguishing them would confirm someone else owns this id.
    super(`Focus session ${id} not found`);
  }
}

/**
 * Two concurrent focus sessions is not a state this product has a meaning for: the whole
 * point is that a session is a bounded block of attention.
 *
 * Refused rather than silently stopping the other one, and the slug is why: the SPA
 * branches on it to offer "stop the running one and start this" as a single tap. Auto-
 * stopping would silently end a block whose debrief you never got to write.
 */
export class FocusSessionAlreadyRunning extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "focus-session-already-running";
  readonly detailKey: ServerMessageKey = "error.focus.already_running";

  constructor(runningId: string) {
    super(`Focus session ${runningId} is still running`);
  }
}

export class FocusSessionNotRunning extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "focus-session-not-running";
  readonly detailKey: ServerMessageKey = "error.focus.not_running";

  constructor(id: string) {
    super(`Focus session ${id} has already been stopped`);
  }
}

export class FocusSessionNotStopped extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "focus-session-not-stopped";
  readonly detailKey: ServerMessageKey = "error.focus.not_stopped";

  constructor(id: string) {
    super(`Focus session ${id} is still running`);
  }
}

/**
 * The lesson a session claims to be about is not one of yours (FR-F3).
 *
 * `invalid` with a field violation rather than `not_found`, because the *session*
 * is fine and one field of it is not — the SPA marks the field rather than showing
 * a page-level error over a timer that is otherwise ready to start.
 *
 * Refused rather than dropped. Silently starting an unbound session would mean the
 * reader's "start focus on this lesson" quietly recorded time against nothing, and
 * the learner would only find out in M6 when the lesson showed zero minutes.
 */
export class FocusSessionLessonMissing extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "focus-session-lesson-missing";
  readonly detailKey: ServerMessageKey = "error.focus.lesson_missing";
  override readonly violations: readonly FieldViolation[];

  constructor(lessonId: string) {
    super(`Lesson ${lessonId} not found`);
    this.violations = [{ field: "lessonId", code: "not_found", message: this.message }];
  }
}

/**
 * A session naming both a lesson and a mission the lesson is not in.
 *
 * Reachable from a replayed offline capture whose mission has since changed, and
 * from nothing the reader sends today. Refused rather than resolved in either
 * direction: picking the lesson's mission would silently move the block's
 * attribution, and picking the sent mission would store a pair the time views then
 * disagree about.
 */
export class FocusSessionLessonMismatch extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "focus-session-lesson-mismatch";
  readonly detailKey: ServerMessageKey = "error.focus.lesson_mission_mismatch";
  override readonly violations: readonly FieldViolation[];

  constructor(lessonId: string, missionId: string) {
    super(`Lesson ${lessonId} does not belong to mission ${missionId}`);
    this.violations = [{ field: "lessonId", code: "mission_mismatch", message: this.message }];
  }
}

/**
 * A session dated in the future.
 *
 * A device with a skewed clock — or a hand-typed date — otherwise produces a block that sorts to the
 * top of every "recent" list permanently and counts toward `focus_hours` goals for work that has not
 * happened. The friction path already clamps for exactly this reason; a session is rejected rather
 * than clamped because both of its boundaries are the user's own claim, and silently moving them
 * would record a duration they did not enter.
 */
export class SessionInFuture extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "session-in-future";
  readonly detailKey: ServerMessageKey = "error.focus.in_future";
  override readonly violations: readonly FieldViolation[];

  constructor(field: "startedAt" | "endedAt") {
    super(`${field} is in the future`);
    this.violations = [{ field, code: "in_future", message: this.message }];
  }
}
