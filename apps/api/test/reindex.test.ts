import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReindexWorkspace } from "../src/modules/teach/application/reindex-workspace.js";
import { adminDb, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * Parsed files → rows, against real Postgres.
 *
 * The unit tests prove the parsers read a format. These prove the things only a
 * database can show, and every one of them is a way a *second* run corrupts what
 * the first one got right:
 *
 * - Re-running the same reindex must produce the same rows, not twice as many.
 * - A `unique (mission_id, seq)` collision must warn rather than fail a run that
 *   otherwise wrote a good lesson.
 * - `lessons.completed_at` is set by the reader in M4, not by any file — so a
 *   reindex must not erase it.
 * - A record's `Date:` must resolve in the learner's zone, because a day either
 *   side of local midnight is a different weekly review.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let reindex: ReindexWorkspace;
let missionId: string;

const encoder = new TextEncoder();
const file = (text: string): Uint8Array => encoder.encode(text);

function workspace(entries: Record<string, string>): ReadonlyMap<string, Uint8Array> {
  return new Map(Object.entries(entries).map(([path, text]) => [path, file(text)]));
}

const LESSON =
  "<html><head><title>Closures and capture</title></head><body><p>Hi</p></body></html>";

const RECORD = `# 0007. Policies do not apply to the table owner

Date: 2026-08-08
Lesson: ../lessons/0007-rls.html

## What Was Learned

A policy is not consulted for a role that owns the table.

## Next

How SET LOCAL interacts with a connection pool.
`;

function run(files: Record<string, string>, timezone = "UTC") {
  return reindex.execute({
    userId: alice.id,
    missionId,
    files: workspace(files),
    deleted: [],
    timezone,
  });
}

beforeAll(async () => {
  app = await bootApp();
  db = adminDb();
  alice = await signUp();
  reindex = app.get(ReindexWorkspace, { strict: false });
});

afterAll(async () => {
  await deleteUsers(db, [alice.id]);
  await app.close();
  await db.$disconnect();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`delete from missions where user_id = $1::uuid`, alice.id);
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'Postgres RLS', 'active', 'postgres-rls', now(), now())
     returning id`,
    alice.id,
  );
  missionId = rows[0]!.id;
});

describe("indexing a workspace", () => {
  it("writes a lesson row a library can list", async () => {
    // Half of NORTHSTAR's finish line: "a lesson file exists in Storage **and a
    // row exists in Postgres**".
    const result = await run({ "lessons/0007-rls.html": LESSON });

    expect(result.lessons).toBe(1);
    const rows = await db.$queryRawUnsafe<{ seq: number; title: string; slug: string }[]>(
      `select seq, title, slug from lessons where mission_id = $1::uuid`,
      missionId,
    );
    expect(rows[0]).toMatchObject({ seq: 7, title: "Closures and capture", slug: "rls" });
  });

  it("writes reference docs and learning records", async () => {
    const result = await run({
      "reference/ownership.html": "<title>Ownership</title>",
      "learning-records/0007-policies.md": RECORD,
    });

    expect(result).toMatchObject({ referenceDocs: 1, records: 1 });
  });

  it("keeps the record's Next section, which is the only ZPD input M3 has", async () => {
    await run({ "learning-records/0007-policies.md": RECORD });

    const rows = await db.$queryRawUnsafe<{ next: string }[]>(
      `select next from learning_records where mission_id = $1::uuid`,
      missionId,
    );
    expect(rows[0]!.next).toContain("connection pool");
  });

  it("skips a lesson with no number rather than inventing one", async () => {
    // `seq` is NOT NULL and unique per mission. There is no honest number to
    // invent — the next free one is a fact about the mission, not the file — so
    // it stays in Storage and out of the index, with a warning.
    const result = await run({ "lessons/closures.html": LESSON });

    expect(result.lessons).toBe(0);
    expect(result.warnings.map((w) => w.code)).toContain("filename_unnumbered");
  });

  it("never indexes a retained conflict copy", async () => {
    // Its filename parses to a sequence that already exists, so indexing it
    // collides on `unique (mission_id, seq)` — and the winner would be arbitrary.
    const result = await run({
      "lessons/0007-rls.html": LESSON,
      "lessons/0007-rls.html.conflict-2026-08-08T12-00-00-000Z": LESSON,
    });

    expect(result.lessons).toBe(1);
  });
});

describe("running the same reindex twice", () => {
  it("produces the same rows, not twice as many", async () => {
    // The whole class of second-run defects, and the cheapest one to catch. Every
    // run re-reads every file it did not change.
    const files = {
      "lessons/0007-rls.html": LESSON,
      "reference/ownership.html": "<title>Ownership</title>",
      "learning-records/0007-policies.md": RECORD,
    };
    await run(files);
    await run(files);

    for (const table of ["lessons", "reference_docs", "learning_records"]) {
      const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
        `select count(*) as n from ${table} where mission_id = $1::uuid`,
        missionId,
      );
      expect(Number(rows[0]!.n)).toBe(1);
    }
  });

  it("does not erase a lesson's completion", async () => {
    // `completed_at` and `outcome` come from the sandboxed reader over
    // postMessage (§7.5) and are in no file. A delete-then-insert reindex — the
    // shape `workspace_files` correctly uses — would throw away the fact that
    // somebody read the lesson, every time the agent ran again.
    await run({ "lessons/0007-rls.html": LESSON });
    await db.$executeRawUnsafe(
      `update lessons set completed_at = now(), outcome = 'understood'
        where mission_id = $1::uuid`,
      missionId,
    );

    await run({ "lessons/0007-rls.html": "<title>Closures, revised</title>" });

    const rows = await db.$queryRawUnsafe<{ outcome: string | null; title: string }[]>(
      `select outcome, title from lessons where mission_id = $1::uuid`,
      missionId,
    );
    expect(rows[0]).toMatchObject({ outcome: "understood", title: "Closures, revised" });
  });

  it("does not multiply mission_revisions", async () => {
    // The trap §7.4's parser table walks into: it maps MISSION.md to `missions`
    // *and* `mission_revisions`, and `## History` does not shrink. Three runs
    // would triple a ledger the product reads as a drift signal.
    //
    // Avoided by construction rather than by deduping: the reindexer routes
    // fields through `UpdateMission`, whose `applyEdit` records a revision only
    // when a field actually moved.
    const mission = `# Mission\n\n## Topic\n\nPostgres row-level security\n\n## History\n\n- 2026-08-01: Created.\n- 2026-08-05: Narrowed.\n`;
    await run({ "MISSION.md": mission });
    await run({ "MISSION.md": mission });
    await run({ "MISSION.md": mission });

    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from mission_revisions where mission_id = $1::uuid`,
      missionId,
    );
    // One: the first run changed the topic from "Postgres RLS". The next two
    // changed nothing.
    expect(Number(rows[0]!.n)).toBe(1);
  });
});

describe("MISSION.md", () => {
  it("updates the mission's fields", async () => {
    await run({
      "MISSION.md": `# Mission\n\n## Topic\n\nRow-level security in depth\n\n## Why\n\nTo stop trusting my policies.\n`,
    });

    const rows = await db.$queryRawUnsafe<{ topic: string; why: string | null }[]>(
      `select topic, why from missions where id = $1::uuid`,
      missionId,
    );
    expect(rows[0]).toMatchObject({
      topic: "Row-level security in depth",
      why: "To stop trusting my policies.",
    });
  });

  it("leaves the stored topic alone when the file has none", async () => {
    // The file may be mid-edit or still a template. Blanking a mission the
    // learner typed into the app, because a parse came back empty, is the kind of
    // data loss non-negotiable 5 exists to prevent.
    await run({ "MISSION.md": `# Mission\n\n## Topic\n\n<what the user is learning>\n` });

    const rows = await db.$queryRawUnsafe<{ topic: string }[]>(
      `select topic from missions where id = $1::uuid`,
      missionId,
    );
    expect(rows[0]!.topic).toBe("Postgres RLS");
  });

  it("does not move the workspace key when the topic changes", async () => {
    // §16.7. The key is a path: recompute it on a rename and the next run
    // materialises an empty prefix while the learner's history sits under a name
    // nothing points at.
    await run({ "MISSION.md": `# Mission\n\n## Topic\n\nSomething else entirely\n` });

    const rows = await db.$queryRawUnsafe<{ workspace_key: string }[]>(
      `select workspace_key from missions where id = $1::uuid`,
      missionId,
    );
    expect(rows[0]!.workspace_key).toBe("postgres-rls");
  });
});

describe("a record's date", () => {
  it("resolves in the learner's timezone, not the server's", async () => {
    // 2026-08-08 in São Paulo (UTC−3) begins at 03:00 UTC. Resolved as
    // `new Date("2026-08-08")` it would be 00:00 UTC — which is the 7th locally,
    // and therefore a different weekly review.
    await run({ "learning-records/0007-policies.md": RECORD }, "America/Sao_Paulo");

    const rows = await db.$queryRawUnsafe<{ recorded_at: Date }[]>(
      `select recorded_at from learning_records where mission_id = $1::uuid`,
      missionId,
    );
    expect(rows[0]!.recorded_at.toISOString()).toBe("2026-08-08T03:00:00.000Z");
  });

  it("falls back to now rather than losing a record with an unreadable date", async () => {
    const undated = RECORD.replace("Date: 2026-08-08", "Date: last Tuesday");
    const result = await run({ "learning-records/0007-policies.md": undated });

    expect(result.records).toBe(1);
    expect(result.warnings.map((w) => w.code)).toContain("value_malformed");
  });
});

describe("forgetting", () => {
  it("removes the row when the agent deleted the file", async () => {
    // These tables are an index over Storage. A lesson row pointing at a path
    // that no longer exists is a library entry that 404s.
    await run({ "lessons/0007-rls.html": LESSON });

    await reindex.execute({
      userId: alice.id,
      missionId,
      files: new Map(),
      deleted: ["lessons/0007-rls.html"],
      timezone: "UTC",
    });

    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from lessons where mission_id = $1::uuid`,
      missionId,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
