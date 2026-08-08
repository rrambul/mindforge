import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { UnauthenticatedError } from "../errors/common-errors.js";
import type { AuthProfile, ProfileReader } from "./profile-reader.js";
import { Public } from "./public.decorator.js";
import { requestContextOf } from "./request-context.js";
import { SupabaseAuthGuard } from "./supabase-auth.guard.js";
import type { TokenVerifier } from "./token-verifier.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const PROFILE: AuthProfile = {
  userId: USER_ID,
  locale: "pt-BR",
  contentLanguage: "en",
  timezone: "America/Sao_Paulo",
  weekStartsOn: 0,
};

/**
 * Real decorators and a real Reflector rather than a stubbed one, so the test
 * covers the `@Public()` metadata actually being readable — the failure mode
 * where the decorator is applied and the guard never sees it.
 */
class ProbeController {
  // `this: void` because the guard receives these as bare handler references. The
  // unbound-method rule is right to ask: a handler reaching for `this` here would
  // be a real bug.
  @Public()
  open(this: void): void {}

  closed(this: void): void {}
}

const PUBLIC_HANDLER = ProbeController.prototype.open;
const PROTECTED_HANDLER = ProbeController.prototype.closed;

function executionContext(request: object, handler: (this: void) => void): ExecutionContext {
  // Structurally what the guard uses, and nothing else. Casting through unknown
  // rather than constructing a real ExecutionContext keeps the test about the
  // guard instead of about Nest's internals.
  return {
    getHandler: () => handler,
    getClass: () => ProbeController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function requestWith(authorization?: string): { headers: Record<string, string | undefined> } {
  return { headers: authorization === undefined ? {} : { authorization } };
}

describe("SupabaseAuthGuard", () => {
  // Held as standalone mocks rather than reached through the fake objects, so an
  // assertion never has to reference an interface method unbound.
  let verify: Mock<TokenVerifier["verify"]>;
  let findForAuth: Mock<ProfileReader["findForAuth"]>;
  let guard: SupabaseAuthGuard;

  beforeEach(() => {
    verify = vi.fn<TokenVerifier["verify"]>().mockResolvedValue({ userId: USER_ID });
    findForAuth = vi.fn<ProfileReader["findForAuth"]>().mockResolvedValue(PROFILE);
    guard = new SupabaseAuthGuard(new Reflector(), { verify }, { findForAuth });
  });

  describe("public routes", () => {
    it("lets a @Public() route through without a token", async () => {
      await expect(
        guard.canActivate(executionContext(requestWith(), PUBLIC_HANDLER)),
      ).resolves.toBe(true);
      expect(verify).not.toHaveBeenCalled();
    });

    it("does not verify a token even when one is supplied", async () => {
      // A liveness probe must not start failing because a caller sent a stale
      // token — that would make the health endpoint report auth problems as
      // outages.
      await expect(
        guard.canActivate(executionContext(requestWith("Bearer whatever"), PUBLIC_HANDLER)),
      ).resolves.toBe(true);
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe("rejecting a request", () => {
    it("rejects a missing Authorization header", async () => {
      await expect(
        guard.canActivate(executionContext(requestWith(), PROTECTED_HANDLER)),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it.each([
      ["empty", ""],
      ["scheme only", "Bearer"],
      ["scheme with no token", "Bearer   "],
      ["wrong scheme", "Basic abc123"],
      ["bare token", "abc123"],
      ["two tokens", "Bearer abc 123"],
    ])("rejects a malformed header: %s", async (_label, header) => {
      await expect(
        guard.canActivate(executionContext(requestWith(header), PROTECTED_HANDLER)),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
      expect(verify).not.toHaveBeenCalled();
    });

    it("rejects a header sent more than once", async () => {
      // Fastify hands a repeated header over as an array. Picking one of them
      // would be choosing which of two conflicting claims of identity to trust.
      const request = { headers: { authorization: ["Bearer a", "Bearer b"] } };
      await expect(
        guard.canActivate(executionContext(request, PROTECTED_HANDLER)),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it("rejects a token the verifier refuses", async () => {
      verify.mockRejectedValue(new Error("signature verification failed"));
      await expect(
        guard.canActivate(executionContext(requestWith("Bearer forged"), PROTECTED_HANDLER)),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it("does not tell the caller why the token was refused", async () => {
      // Expired, wrong issuer, and bad signature are one outcome for the caller.
      // The distinction is free reconnaissance and changes nothing the user can
      // do, so it belongs in the log — which is where `reason` goes.
      verify.mockRejectedValue(new Error("exp claim timestamp check failed"));

      await expect(
        guard.canActivate(executionContext(requestWith("Bearer expired"), PROTECTED_HANDLER)),
      ).rejects.toMatchObject({
        detailKey: "error.unauthenticated",
        detailVars: {},
      });
    });

    it("rejects a valid token whose account no longer exists", async () => {
      // Access must end when the row does, not when the token expires. Otherwise
      // deleting an account leaves up to an hour of usable credentials behind and
      // FR-A4 is a promise the API does not keep.
      findForAuth.mockResolvedValue(null);
      await expect(
        guard.canActivate(executionContext(requestWith("Bearer valid"), PROTECTED_HANDLER)),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });

  describe("accepting a request", () => {
    it("attaches the profile's settings, not the request's", async () => {
      // The context is built from stored preferences (§5.2). If this ever read a
      // header, a Brazilian user on a borrowed English browser would silently get
      // English error copy and Monday-based weeks.
      const request = requestWith("Bearer valid");

      await expect(guard.canActivate(executionContext(request, PROTECTED_HANDLER))).resolves.toBe(
        true,
      );

      expect(requestContextOf(request)).toEqual({
        userId: USER_ID,
        locale: "pt-BR",
        contentLanguage: "en",
        timezone: "America/Sao_Paulo",
        weekStartsOn: 0,
      });
    });

    it("looks the profile up by the verified subject, never by anything the caller sent", async () => {
      await guard.canActivate(executionContext(requestWith("Bearer valid"), PROTECTED_HANDLER));
      expect(findForAuth).toHaveBeenCalledWith(USER_ID);
    });

    it.each([
      ["lowercase scheme", "bearer valid"],
      ["mixed case", "BeArEr valid"],
      ["tab separator", "Bearer\tvalid"],
      ["surrounding whitespace", "  Bearer valid  "],
    ])("accepts a well-formed header written as: %s", async (_label, header) => {
      await expect(
        guard.canActivate(executionContext(requestWith(header), PROTECTED_HANDLER)),
      ).resolves.toBe(true);
      expect(verify).toHaveBeenCalledWith("valid");
    });
  });
});
