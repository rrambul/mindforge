import type { TFunction } from "i18next";
import type { ApiError, FieldViolation } from "../../../shared/api/problem.js";

/**
 * Turns the API's field violations into copy in the user's language.
 *
 * `errors[].message` from the server is English developer detail and must never be
 * rendered (§6.1). `errors[].code` is the stable machine key, so the mapping is
 * `missions:field.<field>.<code>` — which is why the bundles carry a `field` block per
 * form rather than one generic "invalid" string.
 *
 * Falls back to the problem's own translated `detail` when a code has no specific copy
 * yet. That is always a real sentence in the right language, which beats both a raw key
 * and English.
 */
export function fieldErrorsFrom(
  error: ApiError | null,
  t: TFunction<"missions">,
): ReadonlyMap<string, string> {
  if (!error?.problem) return new Map();

  return new Map(
    error.problem.errors.map((violation) => [violation.field, translate(violation, error, t)]),
  );
}

function translate(violation: FieldViolation, error: ApiError, t: TFunction<"missions">): string {
  const key = `field.${violation.field}.${violation.code}`;
  const translated = t(key, { defaultValue: "" });
  if (translated !== "") return translated;

  // No per-code copy for this one yet. The server's detail is generic but honest and
  // already localised.
  return error.problem?.detail ?? "";
}
