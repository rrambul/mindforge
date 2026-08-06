import {
  DomainError,
  type DomainErrorKind,
  type FieldViolation,
  type ServerMessageKey,
} from "@mindforge/core";

export class ResourceNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "resource-not-found";
  readonly detailKey: ServerMessageKey = "error.resource.not_found";

  constructor(id: string) {
    super(`Resource ${id} not found`);
  }
}

/**
 * An article is read or not, and docs are returned to rather than completed (FR-R1).
 *
 * Refused rather than silently accepted, because storing a page number against something with no
 * pages produces a figure that later looks meaningful — and `UNIT_FOR_TYPE` exists precisely so the
 * UI never offers the control in the first place. Reaching this means a client ignored it.
 */
export class ResourceHasNoProgress extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "resource-has-no-progress";
  readonly detailKey: ServerMessageKey = "error.resource.no_progress";

  constructor(type: string) {
    super(`A ${type} is not measured in units`);
  }
}

/**
 * A position outside the resource — negative, or past a total the client cannot see.
 *
 * A `DomainError` rather than the `RangeError` an entity would normally throw for a bad argument,
 * because this one is reachable from the wire: the total lives in the stored row, so no request
 * schema can catch it. Left as a `RangeError` it became a 500 — telling the user "nothing you did
 * caused this" about a number they typed, and hiding a real fault among the noise if a genuine
 * `RangeError` ever appeared.
 */
export class ProgressOutOfRange extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "progress-out-of-range";
  readonly detailKey: ServerMessageKey = "error.resource.progress_out_of_range";
  override readonly detailVars: { readonly total: number; readonly unit: string };
  override readonly violations: readonly FieldViolation[];

  constructor(current: number, total: number | null, unit: string) {
    super(`progress ${current} is not within 0..${total ?? "unbounded"}`);
    // `total: 0` is the catalogue's "no total known" branch, which says only that the position is
    // invalid rather than inventing a bound to quote.
    this.detailVars = { total: total ?? 0, unit };
    // Named so the SPA can put the message beside the field the user typed into, which is the whole
    // reason `invalid` is the one kind that carries violations.
    this.violations = [{ field: "current", code: "out_of_range", message: this.message }];
  }
}

/**
 * A resource linked to something that is not there.
 *
 * Same reasoning as the goals module's `TargetSubjectMissing`: checked so the client gets a 422 naming
 * the field rather than a 500 from a foreign-key violation, and reachable simply by having a stale list
 * open in another tab.
 */
export class LinkTargetMissing extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "link-target-missing";
  readonly detailKey: ServerMessageKey = "error.resource.link_target_missing";
  override readonly detailVars: { readonly kind: string };
  override readonly violations: readonly FieldViolation[];

  constructor(kind: "mission" | "skill", id: string) {
    super(`No ${kind} ${id}`);
    this.detailVars = { kind };
    this.violations = [{ field: `${kind}Ids`, code: "not_found", message: this.message }];
  }
}
