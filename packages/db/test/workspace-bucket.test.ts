import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";

/**
 * The teach workspace bucket, and the claim its migration makes.
 *
 * `20260808150000_workspace_bucket` creates a private bucket and **no policies**,
 * on the grounds that RLS on `storage.objects` then denies everyone except the
 * service role. That is a security claim about somebody else's schema, made in a
 * comment, in a migration nobody will re-read — which is exactly the shape of the
 * `withRls` mistake that left FR-A3 false for two milestones.
 *
 * So it is asserted here instead, against the running Storage API rather than
 * against Postgres: the thing being proved is what an HTTP request with a valid
 * `authenticated` token can reach, and `storage.objects` is only half of that.
 *
 * These are the only tests in the repo that talk to Storage over HTTP. They are
 * in `packages/db` because that is where the migration lives and where the RLS
 * suite already runs against the real stack.
 *
 * **Measured, not argued.** Adding one permissive policy —
 * `create policy … on storage.objects for all using (true) with check (true)` —
 * fails **6 of these 9**: every denial claim plus the no-policies assertion. So
 * the suite discriminates on the thing it exists to protect, rather than passing
 * because Storage happened to be unreachable.
 */

const STORAGE_URL = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const ANON_KEY = process.env["SUPABASE_ANON_KEY"] ?? "";
const JWT_SECRET =
  process.env["SUPABASE_JWT_SECRET"] ?? "super-secret-jwt-token-with-at-least-32-characters-long";

const BUCKET = "mindforge";
const ALICE = "88888888-8888-4888-8888-888888888888";
const BOB = "99999999-9999-4999-8999-999999999999";

/** `workspaces/<user_id>/<key>/…` — §7.2's layout, which is also the scoping. */
const ALICE_OBJECT = `workspaces/${ALICE}/rust/MISSION.md`;

const admin = createPrismaClient(
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
);

/**
 * A signed `authenticated` token, minted rather than obtained through a sign-up.
 *
 * The threat being modelled is a real signed-in user reading somebody else's
 * workspace, and the anon key does not model it: anon and authenticated are
 * different Postgres roles, and a policy can grant one without the other.
 */
function authenticatedToken(userId: string): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  const header = encode({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const payload = encode({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + 3600,
  });
  const signature = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

function asServiceRole(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${STORAGE_URL}/storage/v1/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${SERVICE_KEY}`, ...init.headers },
  });
}

function asUser(userId: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${STORAGE_URL}/storage/v1/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${authenticatedToken(userId)}`,
      apikey: ANON_KEY,
      ...init.headers,
    },
  });
}

beforeAll(async () => {
  await asServiceRole(`object/${BUCKET}/${ALICE_OBJECT}`, {
    method: "POST",
    headers: { "content-type": "text/markdown" },
    body: "# Mission\n\n## Topic\n\nAlice's private mission.\n",
  });
});

afterAll(async () => {
  await asServiceRole(`object/${BUCKET}/${ALICE_OBJECT}`, { method: "DELETE" });
  await admin.$disconnect();
});

describe("the mindforge bucket", () => {
  it("exists and is private", async () => {
    // Public would make every lesson in the system readable by URL, which is the
    // one setting that cannot be walked back once objects are out.
    const rows = await admin.$queryRawUnsafe<{ public: boolean }[]>(
      `select public from storage.buckets where id = $1`,
      BUCKET,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.public).toBe(false);
  });

  it("has no policies, which is what makes it deny-by-default", async () => {
    // The migration's central claim. A policy added here would *widen* access —
    // the comment there says so, and this is what stops that from being a comment
    // nobody re-reads.
    const rows = await admin.$queryRawUnsafe<{ policyname: string }[]>(
      `select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'`,
    );

    expect(rows.map((r) => r.policyname)).toEqual([]);
  });

  it("still has RLS enabled on storage.objects", async () => {
    // "No policies" only denies while RLS is on. With it off, no policies means
    // no restrictions — the same fail-open shape as `withRls` connecting as the
    // table owner.
    const rows = await admin.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
      `select c.relrowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'storage' and c.relname = 'objects'`,
    );

    expect(rows[0]!.relrowsecurity).toBe(true);
  });
});

describe("what a signed-in user can reach", () => {
  it("lets the service role read an object", async () => {
    // The control. Without it, every denial below could be a broken bucket rather
    // than a working policy — which is how four of the M2 insert proofs passed.
    const response = await asServiceRole(`object/${BUCKET}/${ALICE_OBJECT}`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Alice's private mission");
  });

  it("refuses to let Bob read Alice's workspace", async () => {
    const response = await asUser(BOB, `object/${BUCKET}/${ALICE_OBJECT}`);

    expect(response.ok).toBe(false);
  });

  it("refuses to let Alice read her own workspace directly", async () => {
    // Deliberate, and worth stating: the browser has no direct path to Storage at
    // all. Lessons are served from a separate origin through short-lived signed
    // URLs the API mints after an ownership check (§7.5), and the path comes from
    // the lesson row rather than from the client. Granting Alice her own prefix
    // would add a second way in that nothing needs.
    const response = await asUser(ALICE, `object/${BUCKET}/${ALICE_OBJECT}`);

    expect(response.ok).toBe(false);
  });

  it("shows nothing when listing the bucket", async () => {
    // A leak here is worse than a read: the object *names* are the workspace
    // layout, so a listing enumerates every mission a user has.
    const response = await asUser(BOB, `object/list/${BUCKET}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 100 }),
    });

    expect(await response.json()).toEqual([]);
  });

  it("refuses to let Bob write into Alice's workspace", async () => {
    // The write half. Without it Bob can plant a lesson in Alice's mission that he
    // cannot read back — data corruption nobody is looking at, which is the same
    // argument the `WITH CHECK` proofs make for every table.
    const response = await asUser(BOB, `object/${BUCKET}/workspaces/${ALICE}/rust/EVIL.md`, {
      method: "POST",
      headers: { "content-type": "text/markdown" },
      body: "planted",
    });

    expect(response.ok).toBe(false);
  });

  it("refuses to let Bob delete Alice's workspace", async () => {
    const response = await asUser(BOB, `object/${BUCKET}/${ALICE_OBJECT}`, { method: "DELETE" });
    expect(response.ok).toBe(false);

    // And the object survived, which the status code alone does not prove.
    const still = await asServiceRole(`object/${BUCKET}/${ALICE_OBJECT}`);
    expect(still.status).toBe(200);
  });
});
