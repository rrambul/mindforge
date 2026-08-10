import { contentTypeFor, resolveGrantedPath, verifyViewToken } from "@mindforge/core";

import type { LessonsEnv } from "./env.js";
import type { WorkspaceObjects } from "./objects.js";

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

export interface HandlerDeps {
  readonly env: LessonsEnv;
  readonly objects: WorkspaceObjects;
  /** Seconds since the epoch. Injected so expiry can be tested at both edges. */
  readonly now: () => number;
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const headers = securityHeaders(deps.env.appOrigin);

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return health(deps.env);

    // Not 405 for the rest: a method this service does not implement is not a hint
    // that the path exists. GET is the only verb a read-only origin needs, and HEAD
    // is not used by anything that frames a lesson.
    if (request.method !== "GET") return notFound(headers);
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

function health(env: LessonsEnv): Response {
  return Response.json({
    status: "ok",
    service: "lessons",
    version: env.version,
    commit: env.commit,
  });
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
