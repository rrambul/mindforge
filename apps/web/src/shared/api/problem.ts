/**
 * The client half of the RFC 7807 contract (TECH-DESIGN.md §6.1).
 *
 * The whole point of the server translating `detail` is that this layer does not have
 * to know what went wrong in order to say so. Rendering `detail` is always correct
 * and always in the user's language. `type` exists for the cases where the UI can
 * offer a *recovery*, which is a different question from what to display.
 */

export interface FieldViolation {
  readonly field: string;
  readonly code: string;
  /** English developer detail. Never render this — see the API's FieldViolation. */
  readonly message: string;
}

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly errors: readonly FieldViolation[];
}

const TYPE_BASE = "https://mindforge.app/errors";

/**
 * The slugs the UI actually branches on. Anything not here is rendered as its
 * `detail` and nothing more, which is the default and usually the right answer.
 */
export const PROBLEM = {
  unauthenticated: `${TYPE_BASE}/unauthenticated`,
  validationFailed: `${TYPE_BASE}/validation-failed`,
  wipLimitReached: `${TYPE_BASE}/wip-limit-reached`,
} as const;

/**
 * Thrown by the http client for any non-2xx response.
 *
 * Carries the parsed problem when the server sent one. `problem` is null for the
 * failures that never reach the API — a dropped connection, a proxy's HTML error page
 * — and callers must handle that: on mobile it is the common case, not the edge one.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  is(type: string): boolean {
    return this.problem?.type === type;
  }

  /** Field errors keyed for react-hook-form's `setError`, which uses the same paths. */
  get fieldErrors(): ReadonlyMap<string, FieldViolation> {
    return new Map((this.problem?.errors ?? []).map((violation) => [violation.field, violation]));
  }
}

/**
 * A network failure has no problem body, so it has no translated `detail` either.
 * The caller supplies one from the i18n bundle rather than this layer inventing
 * English copy.
 */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("The request never reached the API");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

export function isProblem(value: unknown): value is Problem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Problem>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.status === "number" &&
    typeof candidate.detail === "string" &&
    Array.isArray(candidate.errors)
  );
}
