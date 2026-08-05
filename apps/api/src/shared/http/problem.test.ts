import { DomainError, type DomainErrorKind, type ServerMessageKey } from "@mindforge/core";
import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationFailedError,
} from "../errors/common-errors.js";
import { internalProblem, problemFromDomainError, statusForKind } from "./problem.js";

class WipLimitReached extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "wip-limit-reached";
  readonly detailKey: ServerMessageKey = "error.mission.wip_limit";
  override readonly detailVars = { limit: 3 };

  constructor() {
    super("WIP limit reached");
  }
}

describe("statusForKind", () => {
  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["not_found", 404],
    ["conflict", 409],
    ["invalid", 422],
  ] as const)("maps %s to %s", (kind, status) => {
    expect(statusForKind(kind)).toBe(status);
  });

  it("reserves 422 for validation, which is the only status carrying field errors", () => {
    // §6.1 is specific: validation failures are 422 with a populated `errors`
    // array, everything else is `errors: []`. 400 would blur that.
    expect(statusForKind("invalid")).toBe(422);
    expect(statusForKind("conflict")).not.toBe(422);
  });
});

describe("problemFromDomainError", () => {
  it("produces the documented wire shape", () => {
    expect(problemFromDomainError(new WipLimitReached(), "en", "/v1/missions")).toEqual({
      type: "https://mindforge.app/errors/wip-limit-reached",
      title: "Conflicts with current state",
      status: 409,
      detail: "You have 3 active missions. Park one before starting another.",
      instance: "/v1/missions",
      errors: [],
    });
  });

  it("translates detail and leaves type and title alone", () => {
    // The split that matters: `detail` is the only user-facing field, and `type`
    // is what the SPA branches on to offer a "park something" action.
    const problem = problemFromDomainError(new WipLimitReached(), "pt-BR", "/v1/missions");
    expect(problem.detail).toBe("Você tem 3 missões ativas. Pause uma antes de começar outra.");
    expect(problem.type).toBe("https://mindforge.app/errors/wip-limit-reached");
    expect(problem.title).toBe("Conflicts with current state");
  });

  it("carries field violations through for a validation failure", () => {
    const violations = [{ field: "topic", code: "too_small", message: "String too short" }];
    const problem = problemFromDomainError(
      new ValidationFailedError(violations),
      "en",
      "/v1/missions",
    );
    expect(problem.status).toBe(422);
    expect(problem.errors).toEqual(violations);
  });

  it.each([
    [new UnauthenticatedError("no token"), 401, "unauthenticated"],
    [new ForbiddenError("someone else's mission"), 403, "forbidden"],
    [new NotFoundError("mission"), 404, "not-found"],
  ])("maps the common errors: %s", (error, status, slug) => {
    const problem = problemFromDomainError(error, "en", "/v1/x");
    expect(problem.status).toBe(status);
    expect(problem.type).toBe(`https://mindforge.app/errors/${slug}`);
    expect(problem.detail).not.toContain("{");
    expect(problem.errors).toEqual([]);
  });

  it("never puts the exception's own message in the response", () => {
    // UnauthenticatedError's message names the failed check for the log. Leaking
    // it would tell an attacker whether a subject exists.
    const error = new UnauthenticatedError("no profile for 1111-2222");
    const problem = problemFromDomainError(error, "en", "/v1/missions");
    expect(JSON.stringify(problem)).not.toContain("1111-2222");
  });
});

describe("internalProblem", () => {
  it("says nothing about what actually failed", () => {
    // The catch-all's response body. An exception message routinely contains a
    // connection string, a row's contents, or a query — the log gets those.
    const problem = internalProblem("en", "/v1/missions");
    expect(problem.status).toBe(500);
    expect(problem.type).toBe("https://mindforge.app/errors/internal");
    expect(problem.detail).toBe("Something went wrong on our end. Nothing you did caused this.");
    expect(problem.errors).toEqual([]);
  });

  it("is translated too, because a 500 is still a screen the user reads", () => {
    expect(internalProblem("pt-BR", "/v1/missions").detail).toBe(
      "Algo deu errado do nosso lado. Não foi nada que você fez.",
    );
  });
});
