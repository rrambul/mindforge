import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import { describeError } from "./describe-error.js";

/** Stands in for `t` from the `common` namespace, so the test asserts which message was chosen. */
const common = (key: string): string => key;

describe("describeError", () => {
  it("distinguishes a request that never arrived from one the server refused", () => {
    // The distinction that matters: there is no `detail` to read when nothing reached the server, so
    // showing the server's words would mean inventing them.
    expect(describeError(new NetworkError(new Error("offline")), common)).toBe("state.offline");
  });

  it("uses the server's own translated detail when there is one", () => {
    const problem = {
      type: "https://mindforge.app/errors/mission-parked",
      title: "Problem",
      status: 422,
      detail: "That mission is parked.",
      instance: "/v1/plans/2026-08-03",
      errors: [],
    };
    expect(describeError(new ApiError(422, problem, problem.detail), common)).toBe(
      "That mission is parked.",
    );
  });

  it("falls back when the failure carries no problem document", () => {
    // A proxy or a crashed process answers with HTML, and `detail` is then a status line nobody can
    // act on.
    expect(describeError(new ApiError(502, null, "502 from /plans"), common)).toBe(
      "error.unexpectedBody",
    );
    expect(describeError(new Error("boom"), common)).toBe("error.unexpectedBody");
  });
});
