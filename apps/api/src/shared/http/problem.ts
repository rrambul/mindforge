import {
  formatServerMessage,
  type DomainError,
  type DomainErrorKind,
  type FieldViolation,
  type Locale,
} from "@mindforge/core";

/**
 * RFC 7807 `application/problem+json` — one error shape for the whole API, so
 * the SPA's error mapping is written once (TECH-DESIGN.md §6.1).
 *
 * The split between translated and stable is the part to get right:
 *
 * | Field             | Audience  | Translated |
 * | ----------------- | --------- | ---------- |
 * | `type`            | machine   | never      |
 * | `title`           | developer | never      |
 * | `detail`          | **user**  | **always** |
 * | `errors[].code`   | machine   | never      |
 * | `errors[].message`| developer | never      |
 *
 * `title` is English and constant per `type`, per RFC 7807's requirement that it
 * not vary between occurrences. The SPA renders `detail`; if it ever renders
 * `title` a user will see English, so treat that as the bug it is.
 */
export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly errors: readonly FieldViolation[];
}

/**
 * Dereferenceable in principle, an identifier in practice. Kept as a constant so
 * the eventual docs site is one edit away rather than a find-and-replace.
 */
const TYPE_BASE = "https://mindforge.app/errors";

/**
 * The single place semantics become HTTP.
 *
 * Domain code names a kind; this decides the status. That is what lets
 * `packages/core` hold the error vocabulary without importing a web framework's
 * idea of what 409 means.
 */
const STATUS_BY_KIND: Readonly<Record<DomainErrorKind, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  // 422 rather than 400: the syntax was fine, the content was not. §6.1 reserves
  // it for validation failures specifically, and it is the only status that
  // arrives with a populated `errors` array.
  invalid: 422,
};

/**
 * Titles are keyed by kind rather than by slug so that a new domain error gets a
 * sensible one for free. A specific error worth a specific title can carry it,
 * but most cannot — and a title nobody reads is not worth a translation table.
 */
const TITLE_BY_KIND: Readonly<Record<DomainErrorKind, string>> = {
  unauthenticated: "Not signed in",
  forbidden: "Not allowed",
  not_found: "Not found",
  conflict: "Conflicts with current state",
  invalid: "Invalid request",
};

export function statusForKind(kind: DomainErrorKind): number {
  return STATUS_BY_KIND[kind];
}

export function problemFromDomainError(
  error: DomainError,
  locale: Locale,
  instance: string,
): ProblemBody {
  return {
    type: `${TYPE_BASE}/${error.slug}`,
    title: TITLE_BY_KIND[error.kind],
    status: STATUS_BY_KIND[error.kind],
    detail: formatServerMessage(locale, error.detailKey, error.detailVars),
    instance,
    errors: error.violations,
  };
}

/**
 * Anything that is not a `DomainError` reaching the filter is a bug, not a rule.
 *
 * The response says nothing about it. An exception message can carry a
 * connection string, a row's contents, or a stack frame, and none of that
 * belongs in a response body — the log gets it instead.
 */
export function internalProblem(locale: Locale, instance: string): ProblemBody {
  return {
    type: `${TYPE_BASE}/internal`,
    title: "Unexpected error",
    status: 500,
    detail: formatServerMessage(locale, "error.internal"),
    instance,
    errors: [],
  };
}
