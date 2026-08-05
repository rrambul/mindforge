/**
 * The error vocabulary shared by every layer.
 *
 * This lives in `packages/core` for the same reason the Zod schemas do: one
 * definition, several consumers. A rule is broken in the API's domain layer, its
 * `detail` is translated at the HTTP boundary, and the SPA decides whether to
 * offer a recovery action — three places that must agree on what the error *is*.
 *
 * The load-bearing design choice is that a `DomainError` names a **kind**, not
 * an HTTP status. Domain code has no business knowing that a broken WIP limit is
 * a 409; it knows the write conflicts with the current state. `shared/http`
 * owns the kind → status mapping, so the dependency rule holds without a
 * per-module translation table (TECH-DESIGN.md §2.1).
 *
 * See TECH-DESIGN.md §6.1 for the wire format these become.
 */

import type { MessageVars, ServerMessageKey } from "../i18n/server-messages.js";

/**
 * Semantic categories, not status codes.
 *
 * `conflict` is the one worth explaining: it means the request was well-formed
 * and the caller was allowed to make it, but the current state says no — a WIP
 * limit reached, a mission parked twice. That is distinct from `invalid`, which
 * means the request itself was malformed.
 */
export type DomainErrorKind =
  "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid";

/**
 * One field-level failure.
 *
 * `code` is a stable machine key and is never translated — the SPA maps it to
 * its own field-level copy. `message` is deliberately **not** user-facing: it is
 * English developer detail for logs and API clients, which is why it does not go
 * through the message catalog. Rendering it to a user would be a bug.
 */
export interface FieldViolation {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;

  /**
   * Stable machine key, kebab-case. Becomes the RFC 7807 `type` URI and is
   * never translated, so the SPA can branch on it — "you hit the WIP limit"
   * wants a *park something* button, and no other 409 does.
   */
  abstract readonly slug: string;

  /** Which catalogued string renders this error's user-facing `detail`. */
  abstract readonly detailKey: ServerMessageKey;

  /** ICU arguments for `detailKey`. */
  readonly detailVars: MessageVars = {};

  /** Populated for `invalid`; empty for everything else, per §6.1. */
  readonly violations: readonly FieldViolation[] = [];

  protected constructor(message: string) {
    super(message);
    // Subclass name rather than "Error", so a log line identifies the rule that
    // was broken without needing the stack.
    this.name = new.target.name;
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
