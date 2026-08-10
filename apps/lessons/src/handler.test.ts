import { signViewToken, type ViewGrant } from "@mindforge/core";
import { beforeEach, describe, expect, test } from "bun:test";

import { loadEnv, type LessonsEnv } from "./env.js";
import { createHandler } from "./handler.js";
import type { WorkspaceObjects } from "./objects.js";

/**
 * What this origin refuses to serve, which is the only thing about it that is
 * interesting. Storage is a map of bytes here — every case below is decided before
 * anything would be fetched, and a test that needed a bucket to prove a traversal
 * is refused is a test nobody runs.
 */

const SECRET = "test-secret-shared-with-the-api";
const NOW = 1_760_000_000;
const MINE = "workspaces/11111111-1111-4111-8111-111111111111/rust";
const THEIRS = "workspaces/22222222-2222-4222-8222-222222222222/rust";

const ENV: LessonsEnv = loadEnv({
  PORT: "3001",
  APP_ORIGIN: "https://app.example",
  SUPABASE_URL: "https://stack.example",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  LESSONS_TOKEN_SECRET: SECRET,
});

class FakeObjects implements WorkspaceObjects {
  readonly asked: string[] = [];
  constructor(private readonly files: Record<string, ArrayBuffer>) {}

  read(path: string): Promise<ArrayBuffer | null> {
    this.asked.push(path);
    return Promise.resolve(this.files[path] ?? null);
  }
}

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

let objects: FakeObjects;

function handler(now = NOW) {
  return createHandler({ env: ENV, objects, now: () => now });
}

function grantFor(prefix: string, expiresAt = NOW + 600): Promise<string> {
  const grant: ViewGrant = { prefix, expiresAt };
  return signViewToken(grant, SECRET);
}

beforeEach(() => {
  objects = new FakeObjects({
    [`${MINE}/lessons/0007-closures.html`]: bytes("<h1>Closures</h1>"),
    [`${MINE}/lessons/0003-café.html`]: bytes("<h1>Café</h1>"),
    [`${MINE}/reference/borrow-checker.html`]: bytes("<h1>Ref</h1>"),
    [`${THEIRS}/lessons/0001-secrets.html`]: bytes("<h1>Theirs</h1>"),
  });
});

describe("serving a granted workspace", () => {
  test("serves a lesson to the holder of a grant for its workspace", async () => {
    const token = await grantFor(MINE);
    const res = await handler()(
      new Request(`https://lessons.example/v/${token}/lessons/0007-closures.html`),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("<h1>Closures</h1>");
  });

  test("serves what a relative link inside a lesson resolves to", async () => {
    // `../reference/borrow-checker.html` from `/v/<token>/lessons/0007.html`.
    const token = await grantFor(MINE);
    const res = await handler()(
      new Request(`https://lessons.example/v/${token}/reference/borrow-checker.html`),
    );

    expect(res.status).toBe(200);
  });

  test("decodes a filename in the learner's own language", async () => {
    const token = await grantFor(MINE);
    const res = await handler()(
      new Request(`https://lessons.example/v/${token}/lessons/0003-caf%C3%A9.html`),
    );

    expect(res.status).toBe(200);
    expect(objects.asked).toEqual([`${MINE}/lessons/0003-café.html`]);
  });

  test("404s a path the workspace does not have, without saying so", async () => {
    const token = await grantFor(MINE);
    const res = await handler()(
      new Request(`https://lessons.example/v/${token}/lessons/nope.html`),
    );

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});

describe("what it refuses", () => {
  test("a grant for another workspace cannot reach into this one", async () => {
    // The signature is real; the prefix is theirs. Nothing may cross it.
    const token = await grantFor(THEIRS);
    const res = await handler()(
      new Request(`https://lessons.example/v/${token}/lessons/0007-closures.html`),
    );

    expect(res.status).toBe(404);
    expect(objects.asked).toEqual([`${THEIRS}/lessons/0007-closures.html`]);
  });

  test("a traversal out of the granted prefix never reaches Storage", async () => {
    const token = await grantFor(MINE);
    const res = await handler()(
      new Request(
        `https://lessons.example/v/${token}/lessons/../../22222222-2222-4222-8222-222222222222/rust/lessons/0001-secrets.html`,
      ),
    );

    expect(res.status).toBe(404);
    expect(objects.asked).toEqual([]);
  });

  test("an encoded separator does not become one", async () => {
    // `..%2f..%2f` decodes inside a single segment, which is why the decode happens
    // after the split and the rejoin is what gets checked.
    const token = await grantFor(MINE);
    const res = await handler()(
      new Request(`https://lessons.example/v/${token}/lessons/..%2f..%2fsecrets.md`),
    );

    expect(res.status).toBe(404);
    expect(objects.asked).toEqual([]);
  });

  test("a malformed percent escape is refused rather than guessed at", async () => {
    const token = await grantFor(MINE);
    const res = await handler()(
      new Request(`https://lessons.example/v/${token}/lessons/%E0%A4.html`),
    );

    expect(res.status).toBe(404);
    expect(objects.asked).toEqual([]);
  });

  test("an expired grant stops working", async () => {
    const token = await grantFor(MINE, NOW + 60);
    const res = await handler(NOW + 61)(
      new Request(`https://lessons.example/v/${token}/lessons/0007-closures.html`),
    );

    expect(res.status).toBe(404);
    expect(objects.asked).toEqual([]);
  });

  test("a token signed with another secret stops working", async () => {
    const token = await signViewToken({ prefix: MINE, expiresAt: NOW + 600 }, "somebody-else's");
    const res = await handler()(
      new Request(`https://lessons.example/v/${token}/lessons/0007-closures.html`),
    );

    expect(res.status).toBe(404);
    expect(objects.asked).toEqual([]);
  });

  test.each([
    ["no grant at all", "/lessons/0007-closures.html"],
    ["a grant and no path", "/v/token"],
    ["an empty grant", "/v//lessons/0007-closures.html"],
    ["a garbage grant", "/v/not-a-token/lessons/0007-closures.html"],
  ])("refuses a URL with %s", async (_name, path) => {
    const res = await handler()(new Request(`https://lessons.example${path}`));

    expect(res.status).toBe(404);
    expect(objects.asked).toEqual([]);
  });

  test("refuses a method other than GET", async () => {
    const token = await grantFor(MINE);
    const res = await handler()(
      new Request(`https://lessons.example/v/${token}/lessons/0007-closures.html`, {
        method: "POST",
      }),
    );

    expect(res.status).toBe(404);
    expect(objects.asked).toEqual([]);
  });
});

describe("the headers, on every answer", () => {
  test.each([
    ["a served lesson", "/lessons/0007-closures.html"],
    ["a refusal", "/lessons/../secrets.md"],
  ])("%s carries the isolation headers", async (_name, path) => {
    const token = await grantFor(MINE);
    const res = await handler()(new Request(`https://lessons.example/v/${token}${path}`));
    const csp = res.headers.get("content-security-policy") ?? "";

    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors https://app.example");
    // The grant is in the URL: a lesson linking out must not hand it to the site.
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("the environment", () => {
  test.each(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "LESSONS_TOKEN_SECRET"])(
    "refuses to boot without %s",
    (name) => {
      const source: Record<string, string | undefined> = {
        SUPABASE_URL: "https://stack.example",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        LESSONS_TOKEN_SECRET: SECRET,
      };
      delete source[name];

      expect(() => loadEnv(source)).toThrow(name);
    },
  );

  test("names the variable but never its value", () => {
    expect(() => loadEnv({ SUPABASE_URL: "https://stack.example" })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY, LESSONS_TOKEN_SECRET/u,
    );
  });

  test("refuses a port that is not one", () => {
    expect(() =>
      loadEnv({
        PORT: "not-a-port",
        SUPABASE_URL: "https://stack.example",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        LESSONS_TOKEN_SECRET: SECRET,
      }),
    ).toThrow("PORT");
  });
});

describe("health", () => {
  test("answers GET with the running build, carrying the same headers", async () => {
    const res = await handler()(new Request("https://lessons.example/health"));

    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, string>).toMatchObject({
      status: "ok",
      service: "lessons",
    });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("is not a write endpoint either", async () => {
    // The method check runs before the routing, so nothing on this origin answers
    // a verb it does not implement — including the one route that is not a lesson.
    const res = await handler()(new Request("https://lessons.example/health", { method: "POST" }));

    expect(res.status).toBe(404);
  });
});
