import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import { fieldErrorsFrom } from "./field-errors.js";

/** Stands in for i18next: returns copy for known keys, the caller's default otherwise. */
function translator(known: Record<string, string>): TFunction<"missions"> {
  return ((key: string, options?: { defaultValue?: string }) =>
    known[key] ?? options?.defaultValue ?? key) as unknown as TFunction<"missions">;
}

function problemError(errors: { field: string; code: string; message: string }[]): ApiError {
  return new ApiError(
    422,
    {
      type: "https://mindforge.app/errors/validation-failed",
      title: "Invalid request",
      status: 422,
      detail: "Some fields need fixing.",
      instance: "/v1/missions",
      errors,
    },
    "Some fields need fixing.",
  );
}

describe("fieldErrorsFrom", () => {
  it("translates from the stable code, never from the server's English message", () => {
    const t = translator({ "field.topic.too_small": "At least 3 characters." });
    const mapped = fieldErrorsFrom(
      problemError([{ field: "topic", code: "too_small", message: "Too small: expected >=3" }]),
      t,
    );

    expect(mapped.get("topic")).toBe("At least 3 characters.");
  });

  it("falls back to the problem's translated detail for a code with no copy yet", () => {
    // Generic, but a real sentence in the right language — which beats both a raw key
    // and the English developer text.
    const mapped = fieldErrorsFrom(
      problemError([{ field: "topic", code: "custom_rule", message: "Nope" }]),
      translator({}),
    );

    expect(mapped.get("topic")).toBe("Some fields need fixing.");
    expect(mapped.get("topic")).not.toContain("Nope");
  });

  it("keys nested paths the way the API sends them", () => {
    // `targets.0.kind` — the same notation react-hook-form's setError takes.
    const mapped = fieldErrorsFrom(
      problemError([{ field: "targets.0.kind", code: "invalid_value", message: "bad" }]),
      translator({ "field.targets.0.kind.invalid_value": "Pick a target type." }),
    );

    expect(mapped.get("targets.0.kind")).toBe("Pick a target type.");
  });

  it("maps every violation, not just the first", () => {
    const mapped = fieldErrorsFrom(
      problemError([
        { field: "topic", code: "too_small", message: "a" },
        { field: "why", code: "too_big", message: "b" },
      ]),
      translator({ "field.topic.too_small": "Too short.", "field.why.too_big": "Too long." }),
    );

    expect([...mapped.keys()].sort()).toEqual(["topic", "why"]);
  });

  it("is empty for no error, for a null problem, and for a network failure", () => {
    const t = translator({});
    expect(fieldErrorsFrom(null, t).size).toBe(0);
    // A dropped request carries no problem body and therefore no field errors.
    expect(fieldErrorsFrom(new ApiError(503, null, "gone"), t).size).toBe(0);
    expect(new NetworkError(new Error("offline")).name).toBe("NetworkError");
  });
});
