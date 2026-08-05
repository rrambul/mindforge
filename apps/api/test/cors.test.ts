import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp } from "./support/stack.js";

/**
 * CORS, which the rest of the suite cannot see.
 *
 * Every other integration test goes through `app.inject()`, which is in-process and has no
 * browser enforcing anything — so a CORS misconfiguration passes 57 tests and then blocks the
 * SPA on the first request. This file drives the preflight explicitly, because that is the only
 * way this class of bug is observable below the E2E level.
 *
 * The bug it was written for: `@fastify/cors` defaults `methods` to GET, HEAD, POST. `PATCH
 * /v1/missions/:id` therefore failed its preflight while the endpoint itself worked perfectly,
 * and the browser's error names the *origin* rather than the method — so it reads as an origin
 * problem and sends you looking in the wrong place.
 */

let app: NestFastifyApplication;

const ORIGIN = "http://localhost:5173";

function preflight(url: string, method: string) {
  return app.inject({
    method: "OPTIONS",
    url,
    headers: {
      origin: ORIGIN,
      "access-control-request-method": method,
      "access-control-request-headers": "authorization,content-type",
    },
  });
}

beforeAll(async () => {
  app = await bootApp();
});

afterAll(async () => {
  await app.close();
});

describe("preflight", () => {
  it.each(["GET", "POST", "PATCH", "DELETE"])("allows %s", async (method) => {
    const response = await preflight("/v1/missions/11111111-1111-4111-8111-111111111111", method);

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain(method);
  });

  it("allows the two headers every request actually sends", async () => {
    // Bearer token on all of them, JSON content-type on the writes. Omitting either from the
    // allow-list blocks the request after a successful preflight status.
    const response = await preflight("/v1/missions", "POST");
    const allowed = String(response.headers["access-control-allow-headers"]).toLowerCase();

    expect(allowed).toContain("authorization");
    expect(allowed).toContain("content-type");
  });

  it("echoes only the configured origin", async () => {
    const response = await preflight("/v1/missions", "GET");
    expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
  });

  it("does not allow an origin that is not APP_ORIGIN", async () => {
    // The allow-list is one entry by design. A dev server that silently moved to another port
    // must fail here rather than be quietly accommodated — which is why vite.config.ts sets
    // strictPort.
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/missions",
      headers: {
        origin: "http://localhost:5174",
        "access-control-request-method": "GET",
      },
    });

    expect(response.headers["access-control-allow-origin"]).not.toBe("http://localhost:5174");
  });
});
