import type { CallHandler, ExecutionContext } from "@nestjs/common";
import type { PinoLogger } from "nestjs-pino";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { attachRequestContext } from "../auth/request-context.js";
import { RequestLogContextInterceptor } from "./request-log-context.interceptor.js";

function contextFor(type: "http" | "rpc", request: object | undefined): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const next: CallHandler = { handle: () => of("ok") };

function loggerDouble(): { logger: PinoLogger; assign: ReturnType<typeof vi.fn> } {
  const assign = vi.fn();
  return { logger: { assign } as unknown as PinoLogger, assign };
}

describe("RequestLogContextInterceptor", () => {
  it("puts the user and their timezone on the request's log lines", () => {
    const { logger, assign } = loggerDouble();
    const request = {};
    attachRequestContext(request, {
      userId: "user-1",
      locale: "en",
      contentLanguage: "en",
      timezone: "Europe/Lisbon",
      weekStartsOn: 1,
    });

    new RequestLogContextInterceptor(logger).intercept(contextFor("http", request), next);

    expect(assign).toHaveBeenCalledWith({ userId: "user-1", timezone: "Europe/Lisbon" });
  });

  it("assigns nothing beyond the id and the timezone", () => {
    // A log line outlives the request and is read by people with no access to the
    // account. Locale and week start are preference data with no diagnostic value,
    // and the token must never reach a logger at all.
    const { logger, assign } = loggerDouble();
    const request = {};
    attachRequestContext(request, {
      userId: "user-1",
      locale: "pt-BR",
      contentLanguage: "en",
      timezone: "UTC",
      weekStartsOn: 0,
    });

    new RequestLogContextInterceptor(logger).intercept(contextFor("http", request), next);

    expect(Object.keys(assign.mock.calls[0]?.[0] as object)).toEqual(["userId", "timezone"]);
  });

  it("adds nothing on a public route, where no user has been established", () => {
    const { logger, assign } = loggerDouble();

    new RequestLogContextInterceptor(logger).intercept(contextFor("http", {}), next);

    expect(assign).not.toHaveBeenCalled();
  });

  it("passes the response through untouched", async () => {
    const { logger } = loggerDouble();

    const result = await new Promise((resolve) => {
      new RequestLogContextInterceptor(logger)
        .intercept(contextFor("http", {}), next)
        .subscribe(resolve);
    });

    expect(result).toBe("ok");
  });

  it("ignores a non-HTTP context rather than reading a request that is not there", () => {
    // `switchToHttp()` on a queue consumer's context returns a shell whose
    // `getRequest()` is undefined, and `requestContextOf(undefined)` would throw.
    const { logger, assign } = loggerDouble();

    expect(() =>
      new RequestLogContextInterceptor(logger).intercept(contextFor("rpc", undefined), next),
    ).not.toThrow();
    expect(assign).not.toHaveBeenCalled();
  });
});
