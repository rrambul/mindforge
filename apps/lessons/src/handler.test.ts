import { signViewToken, type ViewGrant } from "@mindforge/core";
import { beforeEach, describe, expect, test } from "bun:test";
import { PYODIDE_VERSION } from "./runner/pyodide.js";

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

describe("the exercise runner", () => {
  // A fake bundle for the routing; the real one is built once, in the last test.
  const SCRIPT = { text: "/* runner */", version: "v1abc" };
  const withRunner = (appOrigin = ENV.appOrigin) =>
    createHandler({
      env: { ...ENV, appOrigin },
      objects,
      now: () => NOW,
      runner: () => Promise.resolve(SCRIPT),
    });

  const cspOf = (res: Response): string[] =>
    (res.headers.get("content-security-policy") ?? "").split("; ");

  test("the page names the app it answers to, and links the current script", async () => {
    const res = await withRunner()(new Request("https://lessons.example/runner"));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain('<meta name="mindforge:app-origin" content="https://app.example" />');
    expect(html).toContain('<script src="/runner.js?v=v1abc"></script>');
  });

  test("the page has no inline script, because its CSP allows none", async () => {
    const html = await (await withRunner()(new Request("https://lessons.example/runner"))).text();

    // Every <script> on the page has a src. An inline one would be silently
    // blocked, and the runner would never say it was ready.
    const scripts = html.match(/<script[^>]*>/gu) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts.every((tag) => tag.includes(" src="))).toBe(true);
  });

  test("the app origin is escaped into the attribute, not pasted", async () => {
    const res = await withRunner('https://app.example" /><script>x</script>')(
      new Request("https://lessons.example/runner"),
    );
    const html = await res.text();

    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&quot; /&gt;&lt;script&gt;");
  });

  const directive = (csp: string[], name: string) =>
    csp.find((part) => part.startsWith(`${name} `));

  test("the JavaScript runner reaches nothing: eval and blob workers, no network, no wasm", async () => {
    for (const path of ["/runner", "/runner.js?v=v1abc"]) {
      const res = await withRunner()(new Request(`https://lessons.example${path}`));
      const csp = cspOf(res);

      expect(directive(csp, "script-src")).toBe("script-src 'self' 'unsafe-eval'");
      expect(csp).toContain("worker-src blob:");
      // JavaScript and TypeScript need nothing from the network, so they get none.
      expect(directive(csp, "connect-src")).toBe("connect-src 'none'");
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors https://app.example");
      expect(csp.join("; ")).not.toContain("'unsafe-inline' 'self'");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  test("the Python runner alone may compile wasm and reach this origin — and no other host", async () => {
    const res = await withRunner()(new Request("https://lessons.example/runner/python"));
    const csp = cspOf(res);

    expect(res.status).toBe(200);
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'");
    // Exactly this origin — Pyodide fetches its own files — so nothing a run does can leave.
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
    expect(csp).toContain("worker-src blob:");
    expect(csp).toContain("frame-ancestors https://app.example");
  });

  test("each page says which languages it runs, and links the same script", async () => {
    const js = await (await withRunner()(new Request("https://lessons.example/runner"))).text();
    const py = await (
      await withRunner()(new Request("https://lessons.example/runner/python"))
    ).text();

    expect(js).toContain('<meta name="mindforge:languages" content="javascript typescript" />');
    expect(py).toContain('<meta name="mindforge:languages" content="python" />');
    expect(py).toContain('<script src="/runner.js?v=v1abc"></script>');
  });

  test("a lesson's CSP is untouched by the runner: no eval, no workers", async () => {
    // The runner's policy is the one exception on this origin. If it ever leaks
    // into the lesson routes, a generated lesson gains `eval` and blob workers —
    // exactly what non-negotiable 7 exists to keep it from having.
    const token = await grantFor(MINE);
    const res = await withRunner()(
      new Request(`https://lessons.example/v/${token}/lessons/0007-closures.html`),
    );
    const csp = res.headers.get("content-security-policy") ?? "";

    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("blob:");
    expect(csp).toContain("script-src 'unsafe-inline' 'self'");
    // The Python runner's `connect-src 'self'` is that page's alone.
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain("wasm-unsafe-eval");
  });

  describe("Pyodide's files", () => {
    const pyodide = (path: string) =>
      withRunner()(new Request(`https://lessons.example/pyodide/${PYODIDE_VERSION}/${path}`));

    test("serves the interpreter with its content type, CORS for the sandboxed frame, cached hard", async () => {
      const res = await pyodide("pyodide.asm.wasm");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/wasm");
      // The runner frame's origin is opaque, so Pyodide's own fetch is cross-origin.
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("cache-control")).toContain("immutable");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });

    test.each(["package.json", "README.md", "../../package.json", "pyodide.d.ts"])(
      "serves nothing off the allowlist: %s",
      async (path) => {
        expect((await pyodide(path)).status).toBe(404);
      },
    );

    test("serves nothing under another version, so an upgrade is a new URL", async () => {
      const res = await withRunner()(
        new Request("https://lessons.example/pyodide/0.0.1/pyodide.js"),
      );

      expect(res.status).toBe(404);
    });
  });

  test("the script is cached hard only under its current version", async () => {
    const current = await withRunner()(new Request("https://lessons.example/runner.js?v=v1abc"));
    const stale = await withRunner()(new Request("https://lessons.example/runner.js?v=old"));

    expect(current.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(current.headers.get("cache-control")).toBe("public, max-age=86400, immutable");
    expect(await current.text()).toBe("/* runner */");
    expect(stale.headers.get("cache-control")).toBe("no-store");
  });

  test("is read-only like everything else here", async () => {
    const res = await withRunner()(
      new Request("https://lessons.example/runner", { method: "POST", body: "{}" }),
    );

    expect(res.status).toBe(404);
  });

  test("the real bundle builds, with the worker inlined into it", async () => {
    // The one test that runs `Bun.build`: a broken import in the browser files
    // otherwise surfaces as a frame that never says it is ready.
    const res = await handler()(new Request("https://lessons.example/runner"));
    const src = /src="([^"]+)"/u.exec(await res.text())?.[1] ?? "";
    const script = await (await handler()(new Request(`https://lessons.example${src}`))).text();

    expect(src).toMatch(/^\/runner\.js\?v=[a-z0-9]+$/u);
    // Booleans rather than `toContain`, so a failure does not print half a
    // megabyte of minified bundle.
    expect(script.includes("mindforge:ready")).toBe(true);
    expect(script.includes("mindforge:result")).toBe(true);
    // A reason key only the JavaScript worker's harness emits, and the Python
    // harness's source — both inlined, since neither page may fetch them.
    expect(script.includes("nothing-registered")).toBe(true);
    expect(script.includes("def run(code, tests)")).toBe(true);
  });
});
