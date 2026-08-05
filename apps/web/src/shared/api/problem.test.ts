import { describe, expect, it } from "vitest";
import { ApiError, isProblem, NetworkError, PROBLEM, type Problem } from "./problem.js";

const PROBLEM_BODY: Problem = {
  type: PROBLEM.wipLimitReached,
  title: "Conflicts with current state",
  status: 409,
  detail: "You have 3 active missions. Park one before starting another.",
  instance: "/v1/missions",
  errors: [],
};

describe("isProblem", () => {
  it("accepts the shape the API actually sends", () => {
    expect(isProblem(PROBLEM_BODY)).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "not a problem"],
    ["an empty object", {}],
    ["a plain JSON error", { error: "nope" }],
    ["errors as a non-array", { type: "t", status: 400, detail: "d", errors: {} }],
  ])("rejects %s", (_label, value) => {
    // A proxy's HTML error page and a crashed process's JSON both land here. Treating
    // one as a problem would render whatever `detail` happened to be present.
    expect(isProblem(value)).toBe(false);
  });
});

describe("ApiError", () => {
  it("branches on the machine key, not on the status", () => {
    // Several rules answer 409; only wip-limit-reached wants a "park something" hint.
    const error = new ApiError(409, PROBLEM_BODY, PROBLEM_BODY.detail);
    expect(error.is(PROBLEM.wipLimitReached)).toBe(true);
    expect(error.is(PROBLEM.validationFailed)).toBe(false);
  });

  it("recognises an expired session by status", () => {
    expect(new ApiError(401, null, "x").isUnauthenticated).toBe(true);
    expect(new ApiError(409, PROBLEM_BODY, "x").isUnauthenticated).toBe(false);
  });

  it("copes with no problem body at all", () => {
    const error = new ApiError(503, null, "upstream gone");
    expect(error.is(PROBLEM.wipLimitReached)).toBe(false);
    expect(error.fieldErrors.size).toBe(0);
  });

  it("keys field errors by path for react-hook-form", () => {
    const error = new ApiError(
      422,
      {
        ...PROBLEM_BODY,
        status: 422,
        type: PROBLEM.validationFailed,
        errors: [{ field: "topic", code: "too_small", message: "Too small" }],
      },
      "Some fields need fixing.",
    );

    expect(error.fieldErrors.get("topic")?.code).toBe("too_small");
  });

  it("is a real Error, so it survives every catch in the stack", () => {
    const error = new ApiError(409, PROBLEM_BODY, PROBLEM_BODY.detail);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
  });
});

describe("NetworkError", () => {
  it("keeps the cause, and is distinguishable from an API error", () => {
    // The distinction the offline queue will need: a request that never arrived is worth
    // replaying, a 422 never is.
    const cause = new TypeError("Failed to fetch");
    const error = new NetworkError(cause);
    expect(error.cause).toBe(cause);
    expect(error).not.toBeInstanceOf(ApiError);
  });
});
