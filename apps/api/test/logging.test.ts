import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp } from "./support/stack.js";

/**
 * That the logger is actually installed, which the unit tests cannot see.
 *
 * `pino-options.test.ts` proves the policy is right — the id is minted, the token
 * is redacted, the probe is skipped. It cannot prove any of it is *reached*: for
 * three milestones `nestjs-pino` was a declared dependency wired into nothing, and
 * every unit test of a config object would have passed just as happily then.
 *
 * The observable consequence of the middleware being registered is the response
 * header, so that is what this asserts. It holds even though the suite runs at
 * `level: "silent"` — `pino-http` assigns the request id before it decides whether
 * to write anything, which is exactly why the header is a safe probe for
 * "installed" rather than for "noisy".
 */

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await bootApp();
});

afterAll(async () => {
  await app.close();
});

describe("request id", () => {
  it("is stamped on a response, so a caller can quote it in a bug report", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("adopts the id the edge assigned", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-request-id": "edge-0f9a21" },
    });

    expect(response.headers["x-request-id"]).toBe("edge-0f9a21");
  });

  it("refuses an inbound id that could forge a log line", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-request-id": "abc def" },
    });

    expect(response.headers["x-request-id"]).not.toBe("abc def");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is stamped on failures too, which are the ones anyone reports", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/missions" });

    expect(response.statusCode).toBe(401);
    expect(response.headers["x-request-id"]).toBeTruthy();
  });
});
