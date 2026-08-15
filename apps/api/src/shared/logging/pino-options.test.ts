import { describe, expect, it } from "vitest";

import type { Env } from "../config/env.js";
import { pinoHttpOptions, requestIdFor, safeRequestId } from "./pino-options.js";

function env(overrides: Partial<Env> = {}): Env {
  return {
    DATABASE_URL: "postgres://localhost/test",
    SUPABASE_URL: "http://localhost:54321",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    PORT: 3000,
    APP_ORIGIN: "http://localhost:5173",
    LESSONS_ORIGIN: "http://localhost:3001",
    LESSONS_TOKEN_SECRET: "secret",
    NODE_ENV: "production",
    LOG_LEVEL: "info",
    TEACH_DAILY_BUDGET_USD: 15,
    ...overrides,
  };
}

describe("level", () => {
  it("honours LOG_LEVEL outside test", () => {
    expect(pinoHttpOptions(env({ LOG_LEVEL: "debug" })).level).toBe("debug");
  });

  it("is silent under test whatever LOG_LEVEL says", () => {
    // The integration suite boots the app once per file. A request line per
    // injection buries the assertion that failed, so the environment wins here.
    const options = pinoHttpOptions(env({ NODE_ENV: "test", LOG_LEVEL: "trace" }));
    expect(options.level).toBe("silent");
  });
});

describe("requestIdFor", () => {
  it("mints a uuid when the caller sent none", () => {
    // A uuid rather than Fastify's per-process counter, which restarts at `req-1`
    // in every replica and every redeploy.
    expect(requestIdFor({})).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("adopts the edge's id so one request keeps one id across the proxy", () => {
    expect(requestIdFor({ "x-request-id": "edge-abc123" })).toBe("edge-abc123");
  });

  it("mints its own when the inbound id could forge a log entry", () => {
    const id = requestIdFor({ "x-request-id": 'abc\nlevel=30 msg="nothing to see"' });

    expect(id).not.toContain("\n");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("safeRequestId", () => {
  it.each([
    ["a plain token", "01HZX3-abc.def:1", true],
    ["a uuid", "3f1a2b4c-1111-4111-8111-222233334444", true],
    ["a newline", "abc\ndef", false],
    ["a space", "abc def", false],
    ["a quote", 'abc"def', false],
    ["empty", "", false],
  ])("%s", (_label, value, accepted) => {
    expect(safeRequestId(value)).toBe(accepted ? value : null);
  });

  it("refuses an id long enough to be a retention bill", () => {
    expect(safeRequestId("a".repeat(129))).toBeNull();
    expect(safeRequestId("a".repeat(128))).toBe("a".repeat(128));
  });

  it("refuses a repeated header, which no legitimate client sends", () => {
    expect(safeRequestId(["one", "two"])).toBeNull();
    expect(safeRequestId(undefined)).toBeNull();
  });
});

describe("redaction", () => {
  it("covers every header that carries a credential", () => {
    // Asserted as a set rather than by inspecting output: pino applies these
    // internally, so the only thing this file can prove is that the policy names
    // the right paths. A token in a log line outlives the request by months.
    expect(pinoHttpOptions(env()).redact.paths).toEqual([
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
    ]);
  });
});

describe("autoLogging.ignore", () => {
  const ignore = pinoHttpOptions(env()).autoLogging.ignore;

  it("reads `originalUrl`, because middie has already rewritten `url`", () => {
    // The bug this exists for, found by curling a running server rather than by
    // any test: Nest mounts its middleware through `@fastify/middie`, which strips
    // the matched prefix from `req.url` before the logger runs. With the global
    // prefix the pattern matches all of `/v1/health`, so `req.url` is `"/"` here
    // and every probe was logged while this suite stayed green.
    expect(ignore({ originalUrl: "/v1/health", url: "/", headers: {} })).toBe(true);
  });

  it("drops the liveness probe", () => {
    // As served, including the global prefix — `setGlobalPrefix("v1")` means the
    // controller's own path is not what arrives here.
    expect(ignore({ originalUrl: "/v1/health", headers: {} })).toBe(true);
    expect(ignore({ originalUrl: "/v1/health?verbose=1", headers: {} })).toBe(true);
  });

  it("falls back to `url` where nothing rewrote it", () => {
    expect(ignore({ url: "/v1/health", headers: {} })).toBe(true);
  });

  it("keeps everything else, including paths that merely contain it", () => {
    expect(ignore({ originalUrl: "/v1/missions", url: "/missions", headers: {} })).toBe(false);
    expect(ignore({ originalUrl: "/v1/health-checks", headers: {} })).toBe(false);
    expect(ignore({ headers: {} })).toBe(false);
  });
});
