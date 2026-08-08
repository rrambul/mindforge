import { describe, expect, it } from "vitest";
import { attachRequestContext, requestContextOf, type RequestContext } from "./request-context.js";

const CONTEXT: RequestContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  locale: "pt-BR",
  contentLanguage: "en",
  timezone: "America/Sao_Paulo",
  weekStartsOn: 0,
};

describe("request context", () => {
  it("round-trips for the request it was attached to", () => {
    const request = {};
    attachRequestContext(request, CONTEXT);
    expect(requestContextOf(request)).toEqual(CONTEXT);
  });

  it("returns null for a request that was never authenticated", () => {
    // This is the `@Public()` case, and it must be a nullable read rather than a
    // throw: the exception filter asks for the context on every response,
    // including responses to public routes.
    expect(requestContextOf({})).toBeNull();
  });

  it("keeps concurrent requests separate", () => {
    // The whole reason this is keyed on the request object rather than stored in
    // a module-level variable. Two in-flight requests from two users must not be
    // able to see each other's identity.
    const alice = {};
    const bob = {};
    attachRequestContext(alice, CONTEXT);
    attachRequestContext(bob, { ...CONTEXT, userId: "22222222-2222-4222-8222-222222222222" });

    expect(requestContextOf(alice)?.userId).toBe(CONTEXT.userId);
    expect(requestContextOf(bob)?.userId).toBe("22222222-2222-4222-8222-222222222222");
  });
});
