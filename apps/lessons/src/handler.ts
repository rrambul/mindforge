import { contentTypeFor, resolveGrantedPath, verifyViewToken } from "@mindforge/core";

import type { LessonsEnv } from "./env.js";
import type { WorkspaceObjects } from "./objects.js";
import { LANGUAGES_META, PAGE_LANGUAGES, type RunnerPage } from "./runner/browser/languages.js";
import { runnerScript, type RunnerScript } from "./runner/bundle.js";
import { pyodideFile } from "./runner/pyodide.js";

/**
 * The lessons origin's whole surface: `/health`, and one route that serves a
 * workspace to whoever holds a grant for it (FR-T5, TECH-DESIGN §7.5).
 *
 * **Why the grant is a path segment.** A lesson's HTML links sideways —
 * `../reference/borrow-checker.html`, `../assets/diagram.png` — and a relative link
 * resolves against the document's URL, carrying the path and nothing else. Put the
 * grant in a query parameter and the first relative link drops it; put it in a
 * cookie and the two origins have to be same-site, which is the isolation this
 * service exists to create. So the URL is `/v/<token>/<path inside the workspace>`
 * and every sideways link lands back inside the same grant, automatically.
 *
 * **This service never trusts a path.** The token names a Storage prefix the API
 * signed after an RLS-checked ownership test; `resolveGrantedPath` decides whether
 * the requested path stays underneath it. Neither half is optional: the signature
 * alone would let a grant-holder walk up into another user's prefix, and the path
 * check alone would let anyone read any workspace they could name.
 *
 * **Every failure is a 404.** Expired, forged, malformed, traversing, missing —
 * one answer, because saying which tells a prober what to change next.
 */

/** Where a view URL begins. Short, because it is repeated in every relative link. */
const VIEW_PREFIX = "/v/";

/**
 * The exercise runners' pages and their one script (FR-X4). Not under `/v/`: they
 * serve no workspace. Two pages because two CSPs — see `runnerHeaders`.
 */
const RUNNER_PAGES: Readonly<Record<string, RunnerPage>> = {
  "/runner": "javascript",
  "/runner/python": "python",
};
const RUNNER_SCRIPT = "/runner.js";

export interface HandlerDeps {
  readonly env: LessonsEnv;
  readonly objects: WorkspaceObjects;
  /** Seconds since the epoch. Injected so expiry can be tested at both edges. */
  readonly now: () => number;
  /** The runner bundle. Injected so tests of the routing need not run `Bun.build`. */
  readonly runner?: () => Promise<RunnerScript>;
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const headers = securityHeaders(deps.env.appOrigin);
  const runner = deps.runner ?? runnerScript;

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Before the routing, not after: a method this service does not implement is
    // not a hint that a path exists, and `/health` is not a write endpoint either.
    // GET is the only verb a read-only origin needs, and HEAD is not used by
    // anything that frames a lesson. 404 rather than 405, for the same reason.
    if (request.method !== "GET") return notFound(headers);

    if (url.pathname === "/health") return health(deps.env, headers);
    const page = RUNNER_PAGES[url.pathname];
    if (page !== undefined) return runnerPage(deps.env, await runner(), page);
    if (url.pathname === RUNNER_SCRIPT) return runnerScriptResponse(deps.env, await runner(), url);
    if (url.pathname.startsWith("/pyodide/")) return pyodideResponse(url.pathname, headers);
    if (!url.pathname.startsWith(VIEW_PREFIX)) return notFound(headers);

    const [token, ...encoded] = url.pathname.slice(VIEW_PREFIX.length).split("/");
    if (token === undefined || token === "" || encoded.length === 0) return notFound(headers);

    const grant = await verifyViewToken(token, deps.env.tokenSecret, deps.now());
    if (grant === null) return notFound(headers);

    // `URL.pathname` stays percent-encoded, so a lesson written in Portuguese
    // arrives as `0003-caf%C3%A9.html` and has to be decoded before it names an
    // object. Decoding **after** the split is what keeps an encoded separator from
    // becoming one: `..%2f..%2fsecret` decodes inside a single segment, and the
    // rejoin below hands `resolveGrantedPath` two `..` segments to refuse.
    const decoded = decodeSegments(encoded);
    if (decoded === null) return notFound(headers);

    const path = resolveGrantedPath(grant, decoded.join("/"));
    if (path === null) return notFound(headers);

    const bytes = await deps.objects.read(path);
    if (bytes === null) return notFound(headers);

    return new Response(bytes, {
      headers: {
        ...headers,
        // From the filename, never from what Storage recorded: an object uploaded
        // by anything other than the worker comes back `application/octet-stream`,
        // and `nosniff` turns that into a lesson the browser offers to download.
        "Content-Type": contentTypeFor(path),
        // Short and private. Long enough that the images in one lesson are not
        // re-fetched as you scroll, short enough that a lesson regenerated over the
        // same path is the one you see when you come back to it.
        "Cache-Control": "private, max-age=60",
      },
    });
  };
}

/** Percent-decode each segment, or null if any of them is not valid encoding. */
function decodeSegments(segments: readonly string[]): string[] | null {
  const decoded: string[] = [];

  for (const segment of segments) {
    try {
      decoded.push(decodeURIComponent(segment));
    } catch {
      // A lone `%` or a truncated escape. Not something a URL builder produces, and
      // not something worth guessing at.
      return null;
    }
  }

  return decoded;
}

function notFound(headers: Record<string, string>): Response {
  return new Response("Not found", {
    status: 404,
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * The headers go on this one too.
 *
 * A JSON body cannot execute anything, so this is belt-and-braces rather than a
 * hole being closed — but "every response from this origin carries them" is a rule
 * that can be checked, and "every response except the one we decided was harmless"
 * is a judgement that has to be made again by whoever adds the next route.
 */
function health(env: LessonsEnv, headers: Record<string, string>): Response {
  return Response.json(
    {
      status: "ok",
      service: "lessons",
      version: env.version,
      commit: env.commit,
    },
    { headers },
  );
}

/**
 * A runner page: no inline script, because its CSP allows none. The app's origin
 * travels in a `<meta>` instead, and the client reads it to know whom to answer —
 * and whom to listen to. A second `<meta>` names the languages this page runs, and
 * the client refuses the rest.
 */
function runnerPage(env: LessonsEnv, script: RunnerScript, page: RunnerPage): Response {
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    `<meta name="mindforge:app-origin" content="${escapeAttribute(env.appOrigin)}" />`,
    `<meta name="${LANGUAGES_META}" content="${PAGE_LANGUAGES[page].join(" ")}" />`,
    "<title>Mindforge exercise runner</title>",
    `<script src="${RUNNER_SCRIPT}?v=${escapeAttribute(script.version)}"></script>`,
    "</head>",
    "<body></body>",
    "</html>",
  ].join("\n");

  return new Response(html, {
    headers: {
      ...runnerHeaders(env.appOrigin, page),
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The script, cached hard only when asked for by its current version. The page
 * always names the version it was built with, so a rebuild is a new URL rather
 * than a stale script; a request for any other version gets it uncached.
 */
function runnerScriptResponse(env: LessonsEnv, script: RunnerScript, url: URL): Response {
  const current = url.searchParams.get("v") === script.version;

  return new Response(script.text, {
    headers: {
      // The script's own CSP is not what governs it — the page's is — so it carries
      // the stricter of the two, the one that describes it everywhere it is not Python.
      ...runnerHeaders(env.appOrigin, "javascript"),
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": current ? "public, max-age=86400, immutable" : "no-store",
    },
  });
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Pyodide's files for the Python runner (Phase 5): public, versioned, immutable.
 *
 * Two headers differ from every other response here, and only on these files:
 *
 * - `Access-Control-Allow-Origin: *`. The runner frame is sandboxed, so its origin
 *   is opaque and Pyodide's own `fetch` of its WebAssembly and standard library is
 *   a cross-origin request that needs CORS to be read.
 * - `Cross-Origin-Resource-Policy: cross-origin`, for the same opaque initiator.
 *
 * Both are safe for the reason they are needed: these are the published Pyodide
 * distribution, byte for byte, with nothing of any learner's in them. A 404 for
 * anything off the allowlist, like every other miss on this origin.
 */
async function pyodideResponse(
  pathname: string,
  headers: Record<string, string>,
): Promise<Response> {
  const file = pyodideFile(pathname);
  if (file === null) return notFound(headers);

  const body = Bun.file(file.path);
  if (!(await body.exists())) return notFound(headers);

  return new Response(body, {
    headers: {
      ...headers,
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}

/**
 * The runners' CSPs — the only places on this origin where `'unsafe-eval'` appears.
 *
 * Running code is what the pages are for, so `eval` is their job rather than a
 * hole. What keeps that safe is everything else, unchanged from a lesson: they are
 * framed `sandbox="allow-scripts"` without `allow-same-origin`, and only by the
 * app. `worker-src blob:` is the other addition, because code runs in a worker
 * built from a Blob URL. `script-src` has no `'unsafe-inline'`: the pages are
 * app-owned and have no inline script to allow.
 *
 * **Two pages, because two policies.** The JavaScript runner (`/runner`) keeps
 * `connect-src 'none'`: JavaScript and TypeScript need nothing from the network,
 * so the agent-written tests that run there can reach nothing at all. The Python
 * runner (`/runner/python`) adds `'wasm-unsafe-eval'` to compile Pyodide and
 * `connect-src 'self'` to fetch its interpreter and standard library. What a Python
 * run can reach is this origin and nothing else, and this origin serves nothing a
 * run could use — `/health`, the runners, Pyodide's public files, and workspaces
 * behind a signed grant the runner frame never holds — so nothing can leave. The
 * relaxation is confined to the one language that needs it; each page names its
 * languages and the client refuses the rest (`runner/languages.ts`).
 *
 * Lesson routes keep `securityHeaders` exactly as they were. A lesson that could
 * `eval` would gain nothing it needs and lose the one directive that makes a
 * generated `<script>` inert as a string.
 */
function runnerHeaders(appOrigin: string, page: RunnerPage): Record<string, string> {
  const python = page === "python";
  const csp = [
    "default-src 'none'",
    // `'wasm-unsafe-eval'` compiles Pyodide; it permits WebAssembly and nothing else.
    python
      ? "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'"
      : "script-src 'self' 'unsafe-eval'",
    "worker-src blob:",
    "style-src 'unsafe-inline'",
    "img-src 'none'",
    python ? "connect-src 'self'" : "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${appOrigin}`,
  ].join("; ");

  return { ...securityHeaders(appOrigin), "Content-Security-Policy": csp };
}

/**
 * The headers that make this origin safe to run someone else's JavaScript on.
 *
 * `connect-src 'none'` is the load-bearing one: a lesson cannot phone home, so even
 * a malicious or confused generation cannot exfiltrate anything it can see —
 * including the grant in its own URL. `frame-ancestors` restricts who may embed us
 * to the app. Do not relax either to make something work.
 *
 * `script-src 'unsafe-inline' 'self'` is not the contradiction it looks like:
 * lessons are single files of LLM-authored HTML with inline `<script>`, so inline
 * *is* the content, and the isolation comes from the origin and the sandbox rather
 * than from forbidding inline script here.
 */
function securityHeaders(appOrigin: string): Record<string, string> {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'self'",
    "style-src 'unsafe-inline' 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${appOrigin}`,
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    // Load-bearing, not hygiene: the grant is *in the URL*, so a lesson linking out
    // to a real documentation site would otherwise hand that site a working token.
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  };
}
