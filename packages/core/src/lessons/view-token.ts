/**
 * The grant that lets the lessons origin serve one workspace, and nothing else
 * (FR-T5, TECH-DESIGN §7.5).
 *
 * **Why a token at all.** Lesson HTML links sideways: `../reference/borrow-checker.html`,
 * `../assets/diagram.png`. Those resolve relative to the document's URL, so the
 * lessons origin has to serve the whole workspace tree rather than one file — and a
 * service that serves a tree needs to know, per request, whose tree it is. The
 * ownership test happens once in the API, under RLS, and its answer travels **in the
 * path** because that is the only part of a URL a relative link carries. A query
 * parameter is dropped by the first `../`; a cookie would need the two origins to be
 * same-site, which is the isolation this whole design exists to create.
 *
 * **Why it lives in `packages/core`.** The API signs and the lessons service
 * verifies — two runtimes, one format. A second implementation of the verifying half
 * is how a signature check becomes a string comparison that happens to return true.
 * `apps/lessons` runs on Bun and reads this from source through the `bun` export
 * condition, so there is no build step standing between the two halves of one
 * security primitive.
 *
 * The token is deliberately **not a JWT**: no algorithm field to confuse, no library,
 * no `alg: none`. One fixed algorithm, HMAC-SHA256, over the exact bytes below.
 */

/** What a token grants: read access under one Storage prefix, until one moment. */
export interface ViewGrant {
  /** A Storage prefix — `workspaces/<user_id>/<workspace_key>`, no trailing slash. */
  readonly prefix: string;
  /** Seconds since the epoch. Whole seconds: this is not a stopwatch. */
  readonly expiresAt: number;
}

/**
 * How long a minted grant lasts.
 *
 * Long enough to read a lesson without its images dying halfway through, short enough
 * that a URL pasted into a chat has stopped working by lunchtime. The reader mints one
 * per lesson opened and never refreshes it in place — swapping the `iframe`'s `src`
 * mid-lesson reloads the document and throws away whatever state the lesson's own
 * JavaScript was holding, which for a simulator is the entire lesson.
 */
export const VIEW_GRANT_TTL_SECONDS = 30 * 60;

const SEPARATOR = ".";

/**
 * Sign a grant. Returns `<payload>.<signature>`, both base64url.
 *
 * The payload is readable by anyone holding the URL, and that is fine: it says which
 * prefix, and until when — both of which the holder already knows. What they cannot
 * do is write a different prefix into it.
 */
export async function signViewToken(grant: ViewGrant, secret: string): Promise<string> {
  const payload = utf8(JSON.stringify({ p: grant.prefix, e: grant.expiresAt }));
  const key = await hmacKey(secret, "sign");
  const signature = new Uint8Array(await platform.crypto.subtle.sign("HMAC", key, payload));

  return `${base64UrlEncode(payload)}${SEPARATOR}${base64UrlEncode(signature)}`;
}

/**
 * Verify a token and return what it grants, or null.
 *
 * **Null for every failure, with no reason attached.** A malformed token, a forged
 * signature and an expired grant are one answer to the caller — 404 — because saying
 * which one it was tells a prober which half of the token to keep working on.
 *
 * `nowSeconds` is passed in rather than read: the repo bans a bare `new Date()`
 * (CLAUDE.md), and an expiry check that reaches for the wall clock is one that cannot
 * be tested at either edge.
 */
export async function verifyViewToken(
  token: string,
  secret: string,
  nowSeconds: number,
): Promise<ViewGrant | null> {
  const parts = token.split(SEPARATOR);
  if (parts.length !== 2) return null;

  const payload = base64UrlDecode(parts[0]!);
  const signature = base64UrlDecode(parts[1]!);
  if (payload === null || signature === null) return null;

  // `subtle.verify` rather than comparing two strings: it compares in constant time,
  // and a byte-by-byte `===` over a signature leaks its prefix through timing to
  // anybody willing to send enough requests.
  const key = await hmacKey(secret, "verify");
  const valid = await platform.crypto.subtle.verify("HMAC", key, signature, payload);
  if (!valid) return null;

  const grant = readPayload(payload);
  if (grant === null) return null;

  // Expiry is checked *after* the signature, so an expired grant and a forged one
  // take the same path out. Non-strict: a grant expiring exactly now is spent.
  return grant.expiresAt <= nowSeconds ? null : grant;
}

/**
 * Resolve a request path against a grant, or refuse it.
 *
 * This is the second half of the ownership check, and it is the half that gets
 * attacked. The grant says "under this prefix", the URL says "this path", and the
 * request is safe only if the resolved object provably stays underneath. So rather
 * than normalising and hoping — `..%2f`, `....//`, a backslash on something that
 * treats it as a separator, a NUL that truncates the name three layers down — every
 * segment is checked against what a segment may contain, and anything else is
 * refused whole.
 *
 * The caller has already percent-decoded the path, because a URL parser does that
 * for you. That is why `%2e%2e` needs no case of its own here and a literal `..`
 * does.
 */
export function resolveGrantedPath(grant: ViewGrant, requestPath: string): string | null {
  // A bound, so a pathological URL cannot turn into a pathological Storage key. No
  // real workspace path comes close; teach's deepest is `assets/<lesson>/<file>`.
  if (requestPath.length === 0 || requestPath.length > 1024) return null;

  const segments = requestPath.replace(/^\/+/u, "").split("/");

  for (const segment of segments) {
    // An empty segment is a doubled slash, a trailing slash, or a bare directory.
    // None of them names an object, and Storage answers the last one with a listing.
    if (segment.length === 0) return null;
    if (segment === "." || segment === "..") return null;
    // What a path could be reinterpreted by later: a separator on another platform,
    // a NUL that truncates the name, anything a control character hides.
    // eslint-disable-next-line no-control-regex -- naming them is exactly the point
    if (/[\\\u0000-\u001f\u007f]/u.test(segment)) return null;
  }

  return `${grant.prefix}/${segments.join("/")}`;
}

/** `{ p, e }` back into a grant, or null when it is not one. */
function readPayload(payload: Uint8Array): ViewGrant | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(payload));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { p, e } = parsed as { p?: unknown; e?: unknown };

  if (typeof p !== "string" || p.length === 0) return null;
  if (typeof e !== "number" || !Number.isFinite(e)) return null;

  return { prefix: p, expiresAt: e };
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<HmacKey> {
  return platform.crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/**
 * base64url, by hand.
 *
 * `btoa`/`atob` exist in Node, Bun and the browser; `Buffer` does not, and this
 * module is loaded by all three. The character swap is what makes the result safe in
 * a path segment: `+` and `/` are not, and `=` is noise in a URL.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  // One byte at a time rather than `String.fromCharCode(...bytes)`, which overflows
  // the argument limit on a large input — this should not have a size at which it
  // starts throwing.
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return platform.btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;

  let binary: string;
  try {
    binary = platform.atob(value.replace(/-/gu, "+").replace(/_/gu, "/"));
  } catch {
    // A length of 1 mod 4 is not base64 at all, whatever its characters are.
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function utf8(value: string): Uint8Array {
  return new platform.TextEncoder().encode(value);
}

function fromUtf8(bytes: Uint8Array): string {
  return new platform.TextDecoder().decode(bytes);
}

/** Opaque on purpose: an imported key is a handle, and nothing here inspects one. */
type HmacKey = { readonly __brand: "HmacKey" };

/**
 * The platform primitives this module needs, named one by one.
 *
 * `packages/core` compiles against `lib: ["ES2023"]` and no `@types/node`, because it
 * is bundled into the browser as well as run in the API and the lessons service — and
 * a `lib` wide enough to type `crypto.subtle` is also wide enough to type `document`,
 * which would let a later change put a DOM call in the package the SPA and the server
 * are supposed to *share*. These five are WHATWG standards present in every runtime
 * that loads this file; declaring them here is the smallest possible way to say
 * "these, and none of the rest of the platform".
 */
interface Platform {
  readonly crypto: {
    readonly subtle: {
      importKey(
        format: "raw",
        keyData: Uint8Array,
        algorithm: { name: "HMAC"; hash: "SHA-256" },
        extractable: boolean,
        keyUsages: readonly ("sign" | "verify")[],
      ): Promise<HmacKey>;
      sign(algorithm: "HMAC", key: HmacKey, data: Uint8Array): Promise<ArrayBuffer>;
      verify(
        algorithm: "HMAC",
        key: HmacKey,
        signature: Uint8Array,
        data: Uint8Array,
      ): Promise<boolean>;
    };
  };
  readonly TextEncoder: new () => { encode(input: string): Uint8Array };
  readonly TextDecoder: new () => { decode(input: Uint8Array): string };
  btoa(data: string): string;
  atob(data: string): string;
}

const platform = globalThis as unknown as Platform;
