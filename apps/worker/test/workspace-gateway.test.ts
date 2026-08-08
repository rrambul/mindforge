import { createPrismaClient } from "@mindforge/db";
import { storageEtag, workspacePrefix } from "@mindforge/workspace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SupabaseWorkspaceGateway } from "../src/modules/teach/infrastructure/supabase-workspace.gateway.js";
import type { Env } from "../src/shared/env.js";

/**
 * The Storage adapter against the real thing.
 *
 * The protocol is tested with doubles in
 * `src/modules/teach/application/workspace-sync.test.ts`, and doubles cannot
 * check the part most likely to be wrong here: what Supabase Storage's client
 * actually returns. Three of this adapter's decisions exist because of behaviour
 * a mock would have been written to agree with —
 *
 *   * `list()` is **not** recursive, and a directory appears as an entry whose
 *     `id` is null,
 *   * neither `download()` nor `upload()` gives you an ETag,
 *   * an ETag is `md5(content)`, quoted,
 *
 * — and a double that got any of them wrong would keep the suite green while the
 * first real run lost a file.
 */

const ADMIN_URL =
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY = "gateway-suite";
const PREFIX = workspacePrefix(USER, KEY);

const admin = createPrismaClient(ADMIN_URL);

const env = {
  SUPABASE_URL: process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
} as Env;

const gateway = new SupabaseWorkspaceGateway(env, admin);

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

let missionId: string;

async function clearPrefix(): Promise<void> {
  const objects = await gateway.list(PREFIX);
  await gateway.remove(objects.map((object) => `${PREFIX}/${object.path}`));
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = $1::uuid`, USER);
  await admin.$executeRawUnsafe(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at)
     values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', $2, '', now(), now(), now())`,
    USER,
    `${USER}@test.local`,
  );
  const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'Gateway suite', 'active', $2, now(), now()) returning id`,
    USER,
    KEY,
  );
  missionId = rows[0]!.id;

  await clearPrefix();
});

afterAll(async () => {
  await clearPrefix();
  await admin.$executeRawUnsafe(`delete from auth.users where id = $1::uuid`, USER);
  await admin.$disconnect();
});

describe("Storage", () => {
  it("round-trips a file", async () => {
    await gateway.upload(`${PREFIX}/MISSION.md`, bytes("# Mission"), "text/markdown");

    expect(text(await gateway.download(`${PREFIX}/MISSION.md`))).toBe("# Mission");
  });

  it("walks nested directories, which list() does not do on its own", async () => {
    // The adapter's least obvious decision. `list()` returns one level, and a
    // subdirectory arrives as an entry with a null id rather than as its
    // contents — so a workspace three levels deep looks empty below the root
    // unless something walks. Storage has no directories at all; the listing
    // synthesises them from shared path segments.
    await gateway.upload(`${PREFIX}/lessons/0001-x.html`, bytes("<h1>one</h1>"), "text/html");
    await gateway.upload(`${PREFIX}/assets/style.css`, bytes("body{}"), "text/css");

    const paths = (await gateway.list(PREFIX)).map((object) => object.path).sort();

    expect(paths).toEqual(["MISSION.md", "assets/style.css", "lessons/0001-x.html"]);
  });

  it("reports paths relative to the prefix, because that is what the ledger stores", async () => {
    const object = (await gateway.list(PREFIX)).find((o) => o.path.startsWith("lessons/"));

    expect(object?.path).toBe("lessons/0001-x.html");
    expect(object?.path).not.toContain("workspaces/");
  });

  it("reports an ETag that is md5 of the content", async () => {
    // The equality the whole conflict check rests on. If Storage ever changes how
    // it computes this — multipart uploads famously do — the check degrades to
    // "everything is a conflict", and this is where that would surface.
    const object = (await gateway.list(PREFIX)).find((o) => o.path === "MISSION.md");

    expect(object?.etag).toBe(storageEtag(bytes("# Mission")));
  });

  it("reports a size", async () => {
    const object = (await gateway.list(PREFIX)).find((o) => o.path === "MISSION.md");

    expect(object?.sizeBytes).toBe(9);
  });

  it("overwrites an existing object rather than refusing", async () => {
    // A run rewrites files it already owns; the conflict decision was made before
    // the upload. Without upsert, a second lesson revision is an error.
    await gateway.upload(`${PREFIX}/MISSION.md`, bytes("# Mission v2"), "text/markdown");

    expect(text(await gateway.download(`${PREFIX}/MISSION.md`))).toBe("# Mission v2");
  });

  it("removes objects", async () => {
    await gateway.upload(`${PREFIX}/NOTES.md`, bytes("scratch"), "text/markdown");
    await gateway.remove([`${PREFIX}/NOTES.md`]);

    const paths = (await gateway.list(PREFIX)).map((object) => object.path);
    expect(paths).not.toContain("NOTES.md");
  });

  it("returns nothing for a prefix that has never been written", async () => {
    // Every first run. An error here rather than an empty list would make a new
    // mission's first teach fail.
    expect(await gateway.list(workspacePrefix(USER, "never-written"))).toEqual([]);
  });
});

describe("the run directory", () => {
  it("writes, reads and walks nested files", async () => {
    const dir = await gateway.openRunDirectory("test-run");
    try {
      await dir.write("MISSION.md", bytes("# Mission"));
      await dir.write("lessons/0001-x.html", bytes("<h1>one</h1>"));

      expect(text(await dir.read("lessons/0001-x.html"))).toBe("<h1>one</h1>");
      expect((await dir.walk()).map((f) => f.path).sort()).toEqual([
        "MISSION.md",
        "lessons/0001-x.html",
      ]);
    } finally {
      await dir.dispose();
    }
  });

  it("hides Mindforge's own scaffolding from the walk", async () => {
    // At the walk, not at the upload. A file skipped only on upload is still in
    // the diff, and diffs as `deleted` on the next run that writes it.
    const dir = await gateway.openRunDirectory("test-run-2");
    try {
      await dir.write("MISSION.md", bytes("# Mission"));
      await dir.write("BRIEFING.md", bytes("# Briefing"));
      await dir.write("SKILL.md", bytes("---"));
      await dir.write(".memory/background.md", bytes("about you"));

      expect((await dir.walk()).map((f) => f.path)).toEqual(["MISSION.md"]);
    } finally {
      await dir.dispose();
    }
  });

  it("uses posix separators, because every path becomes a Storage key", async () => {
    const dir = await gateway.openRunDirectory("test-run-3");
    try {
      await dir.write("a/b/c.md", bytes("deep"));
      expect((await dir.walk())[0]!.path).toBe("a/b/c.md");
    } finally {
      await dir.dispose();
    }
  });

  it("deletes itself on dispose", async () => {
    // Railway's filesystem is ephemeral and a run's workspace is somebody's
    // private learning history. Leaving it behind is both a leak and a disk fill.
    const dir = await gateway.openRunDirectory("test-run-4");
    await dir.write("MISSION.md", bytes("# Mission"));
    await dir.dispose();

    await expect(dir.read("MISSION.md")).rejects.toThrow();
  });
});

describe("the workspace_files ledger", () => {
  it("writes and reads back", async () => {
    await gateway.writeLedger(USER, missionId, [
      {
        path: "MISSION.md",
        contentHash: "sha-1",
        sizeBytes: 9,
        storageEtag: '"abc"',
        storageVersion: "v1",
      },
    ]);

    expect(await gateway.readLedger(USER, missionId)).toEqual([
      {
        path: "MISSION.md",
        contentHash: "sha-1",
        sizeBytes: 9,
        storageEtag: '"abc"',
        storageVersion: "v1",
      },
    ]);
  });

  it("replaces rather than merges, so a deleted file loses its row", async () => {
    // Delete-then-insert, for the reason `daily_activity` rebuilds a range: an
    // upsert can only revise a row that is still there, and a stale row for a file
    // the agent deleted would survive forever — and then diff as `deleted` again
    // on every subsequent run.
    await gateway.writeLedger(USER, missionId, [
      { path: "MISSION.md", contentHash: "sha-1", sizeBytes: 9 },
      { path: "NOTES.md", contentHash: "sha-2", sizeBytes: 7 },
    ]);
    await gateway.writeLedger(USER, missionId, [
      { path: "MISSION.md", contentHash: "sha-3", sizeBytes: 12 },
    ]);

    const ledger = await gateway.readLedger(USER, missionId);
    expect(ledger.map((f) => f.path)).toEqual(["MISSION.md"]);
    expect(ledger[0]!.contentHash).toBe("sha-3");
  });

  it("returns nothing for another user's mission", async () => {
    // The worker bypasses RLS, so this signature is the enforcement rather than a
    // convenience — CLAUDE.md's first non-negotiable.
    const stranger = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    expect(await gateway.readLedger(stranger, missionId)).toEqual([]);
  });
});
