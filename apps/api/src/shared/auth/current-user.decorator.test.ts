import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { UnauthenticatedError } from "../errors/common-errors.js";
import { currentUserFrom } from "./current-user.decorator.js";
import { attachRequestContext, type RequestContext } from "./request-context.js";

const CONTEXT: RequestContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  locale: "en",
  contentLanguage: "en",
  timezone: "Europe/Lisbon",
  weekStartsOn: 1,
};

function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("currentUserFrom", () => {
  it("returns the context the guard attached", () => {
    const request = {};
    attachRequestContext(request, CONTEXT);
    expect(currentUserFrom(contextFor(request))).toEqual(CONTEXT);
  });

  it("throws when no user was established", () => {
    // The wiring mistake this catches: @CurrentUser() on a @Public() handler.
    // Returning undefined instead would let the handler write rows owned by
    // nobody, and the bug would surface as orphaned data days later.
    expect(() => currentUserFrom(contextFor({}))).toThrow(UnauthenticatedError);
  });
});
