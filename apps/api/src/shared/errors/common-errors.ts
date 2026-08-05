import type { ServerMessageKey } from "@mindforge/core";
import { DomainError, type DomainErrorKind, type FieldViolation } from "@mindforge/core";

/**
 * The errors that belong to no particular feature.
 *
 * Feature-specific rules live in their own module's `domain/errors.ts`, next to
 * the invariant they protect. These four are the ones every module raises.
 */

export class UnauthenticatedError extends DomainError {
  readonly kind: DomainErrorKind = "unauthenticated";
  readonly slug = "unauthenticated";
  readonly detailKey: ServerMessageKey = "error.unauthenticated";

  /**
   * `reason` is for the log, never the response. Telling an unauthenticated
   * caller *which* check failed — bad signature, expired, no such profile — is
   * free reconnaissance, and none of the three change what the user must do.
   */
  constructor(reason: string) {
    super(`Unauthenticated: ${reason}`);
  }
}

export class ForbiddenError extends DomainError {
  readonly kind: DomainErrorKind = "forbidden";
  readonly slug = "forbidden";
  readonly detailKey: ServerMessageKey = "error.forbidden";

  constructor(what: string) {
    super(`Forbidden: ${what}`);
  }
}

export class NotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "not-found";
  readonly detailKey: ServerMessageKey = "error.not_found";

  constructor(what: string) {
    super(`Not found: ${what}`);
  }
}

export class ValidationFailedError extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "validation-failed";
  readonly detailKey: ServerMessageKey = "error.validation_failed";
  override readonly violations: readonly FieldViolation[];

  constructor(violations: readonly FieldViolation[]) {
    super(`Validation failed: ${violations.map((v) => v.field).join(", ")}`);
    this.violations = violations;
  }
}
