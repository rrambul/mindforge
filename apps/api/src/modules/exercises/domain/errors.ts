import { DomainError, type DomainErrorKind, type ServerMessageKey } from "@mindforge/core";

/**
 * The lesson is yours and written, but declares no exercise with this key.
 *
 * Most often a regenerated lesson that renamed its exercise while the reader still
 * had the old one open. `not_found`, like a lesson that is not yours: the fix is
 * to reload, not to correct a field.
 */
export class ExerciseNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "exercise-not-found";
  readonly detailKey: ServerMessageKey = "error.exercise.not_found";

  constructor(lessonId: string, key: string) {
    super(`Lesson ${lessonId} declares no exercise "${key}"`);
  }
}

/**
 * A rung above the next one. The ladder is climbed a rung at a time, so the code
 * (rung 5) is never the first thing a learner is shown — that is the whole design,
 * and a client that skipped ahead would be the app handing out answers.
 */
export class HintLevelLocked extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "hint-level-locked";
  readonly detailKey: ServerMessageKey = "error.exercise.hint_locked";

  constructor(requested: number, allowed: number) {
    super(`Hint rung ${requested} asked for; the next one available is ${allowed}`);
  }
}

/**
 * Nobody can be asked: no key is configured, or the one configured is refused —
 * wrong, out of credit, not permitted. Retrying will not help.
 */
export class HintsUnavailable extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";
  readonly slug = "hints-unavailable";
  readonly detailKey: ServerMessageKey = "error.exercise.hints_unavailable";

  constructor(cause?: unknown) {
    super(
      cause === undefined
        ? "Hints need ANTHROPIC_API_KEY, and none is configured"
        : "The hint service refused this install's credentials",
    );
    // Kept for the log line, which is where "which credential, which status" is
    // needed; the learner gets the translated detail and nothing from the SDK.
    this.cause = cause;
  }
}

/** Rate-limited, overloaded or unreachable. Trying again shortly may work. */
export class HintServiceBusy extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";
  readonly slug = "hint-service-busy";
  readonly detailKey: ServerMessageKey = "error.exercise.hint_service_busy";

  constructor(cause: unknown) {
    super("The hint service is not answering right now");
    this.cause = cause;
  }
}

/**
 * The call was made — and billed — but produced no hint: every model declined, or
 * the answer was empty. Said as such rather than shown as a blank hint.
 */
export class HintNotGiven extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";
  readonly slug = "hint-not-given";
  readonly detailKey: ServerMessageKey = "error.exercise.hint_not_given";

  constructor(reason: "refused" | "empty") {
    super(`The hint call returned no hint (${reason})`);
  }
}

/**
 * There is no reference solution to open: the lesson declared none, or it is a
 * whiteboard's reference design, which stays withheld until the first review.
 */
export class SolutionUnavailable extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "solution-unavailable";
  readonly detailKey: ServerMessageKey;

  constructor(key: string, why: "none" | "not-yet") {
    super(`Exercise ${key} has no solution to show (${why})`);
    this.detailKey =
      why === "not-yet" ? "error.exercise.solution_after_review" : "error.exercise.no_solution";
  }
}

/** Reviews need the same key hints do, and there is none, or it is refused. */
export class ReviewsUnavailable extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";
  readonly slug = "reviews-unavailable";
  readonly detailKey: ServerMessageKey = "error.exercise.reviews_unavailable";

  constructor(cause?: unknown) {
    super(
      cause === undefined
        ? "Reviews need ANTHROPIC_API_KEY, and none is configured"
        : "The review service refused this install's credentials",
    );
    this.cause = cause;
  }
}

/** Rate-limited, overloaded or unreachable. Trying again shortly may work. */
export class ReviewServiceBusy extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";
  readonly slug = "review-service-busy";
  readonly detailKey: ServerMessageKey = "error.exercise.hint_service_busy";

  constructor(cause: unknown) {
    super("The review service is not answering right now");
    this.cause = cause;
  }
}

/** Billed, and nothing usable came back: every model declined, or it skipped a rubric item. */
export class ReviewNotGiven extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";
  readonly slug = "review-not-given";
  readonly detailKey: ServerMessageKey = "error.exercise.review_not_given";

  constructor(reason: "refused" | "empty") {
    super(`The review call returned no usable review (${reason})`);
  }
}

/**
 * The endpoint is for the other kind of exercise: a whiteboard is reviewed, not
 * run, and its hints are its review. `conflict`, because the request is well-formed
 * and the exercise is simply not that kind.
 */
export class ExerciseKindMismatch extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "exercise-kind-mismatch";
  readonly detailKey: ServerMessageKey = "error.exercise.kind_mismatch";

  constructor(key: string, expected: "code" | "whiteboard" | "task") {
    super(`Exercise ${key} is not a ${expected} exercise`);
  }
}
