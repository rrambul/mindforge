import {
  DomainError,
  type DomainErrorKind,
  type FieldViolation,
  type ServerMessageKey,
} from "@mindforge/core";

export class FrictionEventNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "friction-event-not-found";
  readonly detailKey: ServerMessageKey = "error.friction.not_found";

  constructor(id: string) {
    super(`Friction event ${id} not found`);
  }
}

/**
 * Attributing friction to something that is not there.
 *
 * The third copy of this idea, after goals and resources, and deliberately not shared: each module
 * checks its own subjects, and one importing another's port is the cross-module dependency the layering
 * keeps out. Checked rather than left to the foreign key so the client gets a 422 naming the field
 * instead of a 500 from the driver.
 */
export class AttributionTargetMissing extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "attribution-target-missing";
  readonly detailKey: ServerMessageKey = "error.friction.target_missing";
  override readonly detailVars: { readonly kind: string };
  override readonly violations: readonly FieldViolation[];

  constructor(kind: "skill" | "resource", id: string) {
    super(`No ${kind} ${id}`);
    this.detailVars = { kind };
    this.violations = [{ field: `${kind}Id`, code: "not_found", message: this.message }];
  }
}
