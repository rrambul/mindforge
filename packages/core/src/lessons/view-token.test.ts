import { describe, expect, it } from "vitest";

import {
  VIEW_GRANT_TTL_SECONDS,
  resolveGrantedPath,
  signViewToken,
  verifyViewToken,
  type ViewGrant,
} from "./view-token.js";

const SECRET = "a-secret-nobody-outside-the-two-services-has";
const NOW = 1_760_000_000;
const GRANT: ViewGrant = {
  prefix: "workspaces/11111111-1111-4111-8111-111111111111/rust-ownership",
  expiresAt: NOW + VIEW_GRANT_TTL_SECONDS,
};

describe("signing and verifying a grant", () => {
  it("round-trips the prefix and the expiry", async () => {
    const grant = await verifyViewToken(await signViewToken(GRANT, SECRET), SECRET, NOW);
    expect(grant).toEqual(GRANT);
  });

  it("produces a token that is safe in a path segment", async () => {
    const token = await signViewToken(GRANT, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
  });

  it("refuses a token signed with another secret", async () => {
    const token = await signViewToken(GRANT, "the-other-deployment's-secret");
    expect(await verifyViewToken(token, SECRET, NOW)).toBeNull();
  });

  /** The attack the signature exists for: swap the prefix, keep the signature. */
  it("refuses a payload edited to name somebody else's workspace", async () => {
    const [, signature] = (await signViewToken(GRANT, SECRET)).split(".");
    const theirs = {
      p: "workspaces/22222222-2222-4222-8222-222222222222/rust",
      e: GRANT.expiresAt,
    };
    const forged = `${base64Url(JSON.stringify(theirs))}.${signature!}`;

    expect(await verifyViewToken(forged, SECRET, NOW)).toBeNull();
  });

  it("refuses a grant that has expired, and one expiring exactly now", async () => {
    const token = await signViewToken({ ...GRANT, expiresAt: NOW }, SECRET);

    expect(await verifyViewToken(token, SECRET, NOW)).toBeNull();
    expect(await verifyViewToken(token, SECRET, NOW + 1)).toBeNull();
    expect(await verifyViewToken(token, SECRET, NOW - 1)).not.toBeNull();
  });

  it.each([
    ["no separator", "not-a-token"],
    ["too many parts", "a.b.c"],
    ["an empty string", ""],
    ["characters base64url cannot contain", "pay+load.sig"],
    ["a payload length base64 cannot produce", "AAAAA.AAAA"],
  ])("refuses %s", async (_name, token) => {
    expect(await verifyViewToken(token, SECRET, NOW)).toBeNull();
  });

  it.each([
    ["is not JSON", "not json at all"],
    ["is JSON but not an object", "42"],
    ["is null", "null"],
    ["has no prefix", JSON.stringify({ e: NOW + 60 })],
    ["has an empty prefix", JSON.stringify({ p: "", e: NOW + 60 })],
    ["has no expiry", JSON.stringify({ p: "workspaces/u/k" })],
    ["has an expiry that is not finite", JSON.stringify({ p: "workspaces/u/k", e: null })],
  ])("refuses a correctly signed payload that %s", async (_name, payload) => {
    // Signed with the real secret, so only the payload check can reject it.
    const token = await signPayload(payload);
    expect(await verifyViewToken(token, SECRET, NOW)).toBeNull();
  });

  it("survives a prefix with characters a workspace key may hold", async () => {
    const grant = { prefix: "workspaces/u/café com leite", expiresAt: NOW + 60 };
    expect(await verifyViewToken(await signViewToken(grant, SECRET), SECRET, NOW)).toEqual(grant);
  });
});

describe("resolving a path under a grant", () => {
  it("joins a lesson path onto the granted prefix", () => {
    expect(resolveGrantedPath(GRANT, "lessons/0007-closures.html")).toBe(
      `${GRANT.prefix}/lessons/0007-closures.html`,
    );
  });

  it("resolves what a relative link inside a lesson becomes", () => {
    // `../reference/x.html` from `/v/<token>/lessons/0007.html` arrives as this.
    expect(resolveGrantedPath(GRANT, "/reference/borrow-checker.html")).toBe(
      `${GRANT.prefix}/reference/borrow-checker.html`,
    );
  });

  it("keeps the accents a lesson filename may legitimately carry", () => {
    expect(resolveGrantedPath(GRANT, "lessons/0003-café-com-leite.html")).toBe(
      `${GRANT.prefix}/lessons/0003-café-com-leite.html`,
    );
  });

  it.each([
    ["a parent segment", "lessons/../../../other-user/secrets.md"],
    ["a bare parent", ".."],
    ["a current-directory segment", "lessons/./0007.html"],
    ["a doubled slash", "lessons//0007.html"],
    ["a trailing slash, which is a directory", "lessons/"],
    ["nothing at all", ""],
    ["a backslash separator", "lessons\\0007.html"],
    ["a NUL that would truncate the name", "lessons/0007.html\u0000.png"],
    ["a newline", "lessons/0007\n.html"],
    ["a DEL", "lessons/0007.html\u007f"],
  ])("refuses %s", (_name, path) => {
    expect(resolveGrantedPath(GRANT, path)).toBeNull();
  });

  it("refuses a path long enough to be an attack rather than a filename", () => {
    expect(resolveGrantedPath(GRANT, `lessons/${"a".repeat(1024)}.html`)).toBeNull();
  });
});

/** base64url, as the token format writes it. */
function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** Sign arbitrary payload bytes with the real secret, bypassing `signViewToken`. */
async function signPayload(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, bytes));

  return `${Buffer.from(bytes).toString("base64url")}.${signature.toString("base64url")}`;
}
