import { DomainError, type DomainErrorKind, type ServerMessageKey } from "@mindforge/core";
import { HttpException, Logger, NotFoundException, type ArgumentsHost } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { attachRequestContext } from "../auth/request-context.js";
import { ProblemExceptionFilter } from "./problem.filter.js";
import type { ProblemBody } from "./problem.js";

class WipLimitReached extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "wip-limit-reached";
  readonly detailKey: ServerMessageKey = "error.mission.wip_limit";
  override readonly detailVars = { limit: 3 };

  constructor() {
    super("WIP limit reached");
  }
}

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: ProblemBody;
}

function hostFor(request: object): { host: ArgumentsHost; sent: Captured } {
  const sent: Captured = { status: 0, headers: {}, body: {} as ProblemBody };
  const reply = {
    status(code: number) {
      sent.status = code;
      return reply;
    },
    header(name: string, value: string) {
      sent.headers[name] = value;
      return reply;
    },
    send(body: unknown) {
      sent.body = body as ProblemBody;
      return reply;
    },
  };

  // Only the two accessors the filter uses.
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ArgumentsHost;

  return { host, sent };
}

describe("ProblemExceptionFilter", () => {
  let filter: ProblemExceptionFilter;
  let logged: {
    error: MockInstance<Logger["error"]>;
    warn: MockInstance<Logger["warn"]>;
    debug: MockInstance<Logger["debug"]>;
  };

  beforeEach(() => {
    // The filter logs on every path; silenced so a passing run is quiet and a
    // failing one is readable. Handles are kept rather than reaching back through
    // Logger.prototype, which reads as an unbound method reference.
    logged = {
      error: vi.spyOn(Logger.prototype, "error").mockImplementation(() => {}),
      warn: vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {}),
      debug: vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {}),
    };
    filter = new ProblemExceptionFilter();
  });

  // Restored rather than cleared: re-spying a still-spied method stacks wrappers,
  // and the call history then spans the whole file — which makes "warn was not
  // called" assert something about every earlier test instead of this one.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always answers with the problem+json content type", () => {
    // Without this the SPA's error mapping has to sniff the body shape, and a
    // 409 arrives looking like a successful JSON response.
    const { host, sent } = hostFor({ url: "/v1/missions", headers: {} });
    filter.catch(new WipLimitReached(), host);
    expect(sent.headers["content-type"]).toBe("application/problem+json");
  });

  describe("domain errors", () => {
    it("maps kind to status and records the path as instance", () => {
      const { host, sent } = hostFor({ url: "/v1/missions", headers: {} });
      filter.catch(new WipLimitReached(), host);

      expect(sent.status).toBe(409);
      expect(sent.body.type).toBe("https://mindforge.app/errors/wip-limit-reached");
      expect(sent.body.instance).toBe("/v1/missions");
    });

    it("translates detail using the authenticated user's stored locale", () => {
      // The whole point of resolving server-side: the user's preference decides,
      // not the browser that happens to be making the request.
      const request = { url: "/v1/missions", headers: { "accept-language": "en-US,en;q=0.9" } };
      attachRequestContext(request, {
        userId: "11111111-1111-4111-8111-111111111111",
        locale: "pt-BR",
        contentLanguage: "en",
        timezone: "America/Sao_Paulo",
        weekStartsOn: 0,
      });

      const { host, sent } = hostFor(request);
      filter.catch(new WipLimitReached(), host);

      expect(sent.body.detail).toBe("Você tem 3 missões ativas. Pause uma antes de começar outra.");
    });

    it("falls back to Accept-Language when no user has been established yet", () => {
      // A 401 happens before there is a stored preference to consult, so the
      // header is the only signal — and using it beats defaulting a Brazilian
      // user to English on the sign-in error they are most likely to see.
      const { host, sent } = hostFor({
        url: "/v1/missions",
        headers: { "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" },
      });
      filter.catch(new WipLimitReached(), host);
      expect(sent.body.detail).toContain("missões ativas");
    });

    it("defaults to English with no context and no usable header", () => {
      const { host, sent } = hostFor({ url: "/v1/missions", headers: {} });
      filter.catch(new WipLimitReached(), host);
      expect(sent.body.detail).toContain("active missions");
    });

    it("ignores an Accept-Language header that is not a string", () => {
      const { host, sent } = hostFor({
        url: "/v1/missions",
        headers: { "accept-language": ["pt-BR", "en"] },
      });
      filter.catch(new WipLimitReached(), host);
      expect(sent.body.detail).toContain("active missions");
    });

    it("logs a 401 at debug so an expired token does not drown the signal", () => {
      class Expired extends DomainError {
        readonly kind: DomainErrorKind = "unauthenticated";
        readonly slug = "unauthenticated";
        readonly detailKey: ServerMessageKey = "error.unauthenticated";
        constructor() {
          super("token rejected");
        }
      }
      const { host } = hostFor({ url: "/v1/missions", headers: {} });
      filter.catch(new Expired(), host);

      expect(logged.debug).toHaveBeenCalled();
      expect(logged.warn).not.toHaveBeenCalled();
    });
  });

  describe("framework exceptions", () => {
    it("wraps an unmatched route in the same shape", () => {
      const { host, sent } = hostFor({ url: "/v1/nope", headers: {} });
      filter.catch(new NotFoundException(), host);

      expect(sent.status).toBe(404);
      expect(sent.body.detail).toBe("We couldn't find that.");
      expect(sent.body.errors).toEqual([]);
    });

    it("uses a catalogued message rather than the framework's English copy", () => {
      const { host, sent } = hostFor({
        url: "/v1/nope",
        headers: { "accept-language": "pt-BR" },
      });
      filter.catch(new NotFoundException("Cannot GET /v1/nope"), host);
      expect(sent.body.detail).toBe("Não encontramos isso.");
      expect(sent.body.detail).not.toContain("Cannot GET");
    });

    it("does not blame itself for a 4xx it has no specific copy for", () => {
      // The bug this pins: `error.internal` says "Nothing you did caused this",
      // which on a 413 is false — the request was the problem. Non-negotiable #10
      // is that the app does not state things that aren't true.
      const { host, sent } = hostFor({ url: "/v1/missions", headers: {} });
      filter.catch(new HttpException("Payload too large", 413), host);

      expect(sent.status).toBe(413);
      expect(sent.body.detail).toBe("That request couldn't be processed.");
      expect(sent.body.detail).not.toContain("our end");
      expect(sent.body.detail).not.toContain("Nothing you did");
    });

    it.each([405, 409, 413, 415, 429])("uses the neutral message for %s", (status) => {
      const { host, sent } = hostFor({ url: "/v1/x", headers: {} });
      filter.catch(new HttpException("framework copy", status), host);
      expect(sent.body.detail).toBe("That request couldn't be processed.");
    });

    it("still blames itself for a 5xx, because there it is true", () => {
      const { host, sent } = hostFor({ url: "/v1/x", headers: {} });
      filter.catch(new HttpException("upstream exploded", 503), host);

      expect(sent.status).toBe(503);
      expect(sent.body.detail).toBe(
        "Something went wrong on our end. Nothing you did caused this.",
      );
    });

    it("logs a framework 5xx at error with its stack, like any other fault", () => {
      // A genuine fault logged at warn with no stack goes unnoticed among the
      // validation failures.
      const { host } = hostFor({ url: "/v1/x", headers: {} });
      filter.catch(new HttpException("upstream exploded", 503), host);

      expect(logged.error).toHaveBeenCalled();
      expect(logged.warn).not.toHaveBeenCalled();
    });

    it.each([
      [401, "Sign in to continue."],
      [403, "You don't have access to this."],
      [400, "Some fields need fixing."],
      [422, "Some fields need fixing."],
    ])("maps status %s to its catalogued message", (status, detail) => {
      const { host, sent } = hostFor({ url: "/v1/x", headers: {} });
      filter.catch(new HttpException("framework copy", status), host);
      expect(sent.body.detail).toBe(detail);
    });
  });

  describe("anything else", () => {
    it("answers 500 and says nothing about what failed", () => {
      const { host, sent } = hostFor({ url: "/v1/missions", headers: {} });
      filter.catch(new Error("connect ECONNREFUSED 127.0.0.1:54322 password=hunter2"), host);

      expect(sent.status).toBe(500);
      expect(JSON.stringify(sent.body)).not.toContain("hunter2");
      expect(JSON.stringify(sent.body)).not.toContain("ECONNREFUSED");
      expect(sent.body.detail).toBe(
        "Something went wrong on our end. Nothing you did caused this.",
      );
    });

    it("logs the stack, since the response deliberately carries nothing", () => {
      const { host } = hostFor({ url: "/v1/missions", headers: {} });
      filter.catch(new Error("boom"), host);
      expect(logged.error).toHaveBeenCalled();
    });

    it("survives a thrown value that is not an Error at all", () => {
      // `throw "nope"` and `throw undefined` are legal, and a filter that assumes
      // otherwise turns a bug into an unhandled rejection with no response.
      const { host, sent } = hostFor({ url: "/v1/missions", headers: {} });
      filter.catch("a string", host);
      expect(sent.status).toBe(500);

      const second = hostFor({ url: "/v1/missions", headers: {} });
      filter.catch(undefined, second.host);
      expect(second.sent.status).toBe(500);
    });

    it("copes with a request that has no url", () => {
      const { host, sent } = hostFor({ headers: {} });
      filter.catch(new Error("boom"), host);
      expect(sent.body.instance).toBe("");
    });
  });
});
