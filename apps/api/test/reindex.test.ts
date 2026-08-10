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

describe("indexing a curriculum", () => {
  const CURRICULUM = `# Curriculum

## Subject

Postgres row-level security

## Tracks

| Order | Slug       | Track            | Outcome                    | Prerequisites |
| ----- | ---------- | ---------------- | -------------------------- | ------------- |
| 1     | pg-basics  | Postgres basics  | Read a query plan          | —             |
| 2     | rls-basics | RLS fundamentals | Read a policy              | pg-basics     |
`;

  const TAGGED = `<html><head><title>Policies</title>
    <meta name="mindforge:track" content="rls-basics" />
    </head><body><p>Hi</p></body></html>`;

  async function tracks() {
    return db.$queryRawUnsafe<{ slug: string; position: number; status: string }[]>(
      `select slug, position, status from tracks where mission_id = $1::uuid order by position`,
      missionId,
    );
  }

  it("writes tracks and their prerequisites", async () => {
    const result = await run({ "CURRICULUM.md": CURRICULUM });

    expect(result.tracks).toBe(2);
    expect(await tracks()).toEqual([
      { slug: "pg-basics", position: 1, status: "proposed" },
      { slug: "rls-basics", position: 2, status: "proposed" },
    ]);

    const [edge] = await db.$queryRawUnsafe<{ track: string; prereq: string }[]>(
      `select t.slug as track, p.slug as prereq from track_edges e
         join tracks t on t.id = e.track_id
         join tracks p on p.id = e.prereq_id
        where t.mission_id = $1::uuid`,
      missionId,
    );
    expect(edge).toEqual({ track: "rls-basics", prereq: "pg-basics" });
  });

  it("revises rather than doubles on a second run", async () => {
    // `(mission_id, slug)` is the upsert key. Without it the module list doubles
    // on the second run and is useless by the tenth — the RESOURCES.md failure,
    // one table over.
    await run({ "CURRICULUM.md": CURRICULUM });
    await run({ "CURRICULUM.md": CURRICULUM.replace("Postgres basics", "Postgres fundamentals") });

    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from tracks where mission_id = $1::uuid`,
      missionId,
    );
    expect(Number(rows[0]!.n)).toBe(2);

    const [renamed] = await db.$queryRawUnsafe<{ name: string }[]>(
      `select name from tracks where mission_id = $1::uuid and slug = 'pg-basics'`,
      missionId,
    );
    expect(renamed!.name).toBe("Postgres fundamentals");
  });

  it("does not reset the open module on a rerun", async () => {
    // `CURRICULUM.md` has no status column, exactly as `RESOURCES.md` has none —
    // so echoing one back would close the module the learner currently has open,
    // on every run, forever. That defect shipped once already in the resource
    // library and is the reason `status` is written on insert only.
    await run({ "CURRICULUM.md": CURRICULUM });
    await db.$executeRawUnsafe(
      `update tracks set status = 'active' where mission_id = $1::uuid and slug = 'rls-basics'`,
      missionId,
    );

    await run({ "CURRICULUM.md": CURRICULUM });

    const rows = await tracks();
    expect(rows.find((t) => t.slug === "rls-basics")!.status).toBe("active");
  });

  it("marks a vanished track dropped and keeps its lessons", async () => {
    // Upsert and never delete. The agent rewrites the file wholesale, so a track
    // missing from one regeneration is much more likely to be a model shortening
    // its output than a decision to abandon a module (non-negotiable 6).
    await run({ "CURRICULUM.md": CURRICULUM, "lessons/0001-policies.html": TAGGED });

    const trimmed = CURRICULUM.replace(
      "| 2     | rls-basics | RLS fundamentals | Read a policy              | pg-basics     |\n",
      "",
    );
    await run({ "CURRICULUM.md": trimmed });

    const rows = await tracks();
    expect(rows.find((t) => t.slug === "rls-basics")!.status).toBe("dropped");

    const [lesson] = await db.$queryRawUnsafe<{ track_id: string | null }[]>(
      `select track_id from lessons where mission_id = $1::uuid and seq = 1`,
      missionId,
    );
    expect(lesson!.track_id).not.toBeNull();
  });

  it("revives a dropped track when the curriculum brings it back", async () => {
    await run({ "CURRICULUM.md": CURRICULUM });
    await db.$executeRawUnsafe(
      `update tracks set status = 'dropped' where mission_id = $1::uuid and slug = 'pg-basics'`,
      missionId,
    );

    await run({ "CURRICULUM.md": CURRICULUM });

    const rows = await tracks();
    expect(rows.find((t) => t.slug === "pg-basics")!.status).toBe("proposed");
  });

  it("files a lesson under the module its own meta tag names", async () => {
    await run({ "CURRICULUM.md": CURRICULUM, "lessons/0001-policies.html": TAGGED });

    const [row] = await db.$queryRawUnsafe<{ track: string }[]>(
      `select t.slug as track from lessons l
         join tracks t on t.id = l.track_id
        where l.mission_id = $1::uuid`,
      missionId,
    );

    expect(row).toEqual({ track: "rls-basics" });
  });

  it("resolves a lesson's module on a run that carried no curriculum", async () => {
    // The normal shape of a teach run: one new lesson, and CURRICULUM.md untouched
    // because the agent is told it is an input. A resolver that only knew this
    // run's tracks would file every real lesson under nothing.
    await run({ "CURRICULUM.md": CURRICULUM });
    await run({ "lessons/0002-more.html": TAGGED });

    const [lesson] = await db.$queryRawUnsafe<{ slug: string }[]>(
      `select t.slug from lessons l join tracks t on t.id = l.track_id
        where l.mission_id = $1::uuid and l.seq = 2`,
      missionId,
    );
    expect(lesson!.slug).toBe("rls-basics");
  });

  it("leaves a pre-curriculum lesson unfiled instead of guessing", async () => {
    await run({ "CURRICULUM.md": CURRICULUM, "lessons/0003-old.html": LESSON });

    const [lesson] = await db.$queryRawUnsafe<{ track_id: string | null }[]>(
      `select track_id from lessons where mission_id = $1::uuid and seq = 3`,
      missionId,
    );
    expect(lesson!.track_id).toBeNull();
  });
});

/**
 * The plan: rows that exist before any file does (FR-K2, §3.2b).
 *
 * These are the second-run failures one level down from the tracks above. A plan
 * is regenerated wholesale on every revision, so each test here is about what the
 * revision must not take with it — a lesson the learner has read, a module the run
 * never reached, or an edge the curriculum no longer states.
 */
describe("indexing a plan", () => {
  const PLANNED = `# Curriculum

## Tracks

| Order | Slug       | Track            | Prerequisites |
| ----- | ---------- | ---------------- | ------------- |
| 1     | pg-basics  | Postgres basics  | —             |
| 2     | rls-basics | RLS fundamentals | pg-basics     |

## Module: pg-basics

| Slug        | Lesson       | Intent          | Difficulty | Depth    | Depends on |
| ----------- | ------------ | --------------- | ---------- | -------- | ---------- |
| query-plans | Query plans  | Read one aloud  | 2          | working  | —          |
| indexes     | Indexes      | Pick one        | 3          | working  | query-plans |

## Module: rls-basics

| Slug          | Lesson       | Intent        | Difficulty | Depth     | Depends on |
| ------------- | ------------ | ------------- | ---------- | --------- | ---------- |
| policy-basics | Policies     | Read a policy | 2          | overview  | indexes    |
`;

  async function planned() {
    return db.$queryRawUnsafe<
      {
        slug: string;
        status: string;
        title: string;
        intent: string | null;
        difficulty: number | null;
        depth: string | null;
        position: number | null;
        track: string | null;
      }[]
    >(
      `select l.slug, l.status, l.title, l.intent, l.difficulty, l.depth, l.position,
              t.slug as track
         from lessons l left join tracks t on t.id = l.track_id
        where l.mission_id = $1::uuid
        order by t.position, l.position`,
      missionId,
    );
  }

  async function edges() {
    return db.$queryRawUnsafe<{ lesson: string; prereq: string }[]>(
      `select l.slug as lesson, p.slug as prereq from lesson_edges e
         join lessons l on l.id = e.lesson_id
         join lessons p on p.id = e.prereq_id
        where l.mission_id = $1::uuid
        order by l.slug`,
      missionId,
    );
  }

  it("writes a module's lessons before any of them exists", async () => {
    const result = await run({ "CURRICULUM.md": PLANNED });

    expect(result.plannedLessons).toBe(3);
    expect(await planned()).toEqual([
      {
        slug: "query-plans",
        status: "planned",
        title: "Query plans",
        intent: "Read one aloud",
        difficulty: 2,
        depth: "working",
        position: 1,
        track: "pg-basics",
      },
      {
        slug: "indexes",
        status: "planned",
        title: "Indexes",
        intent: "Pick one",
        difficulty: 3,
        depth: "working",
        position: 2,
        track: "pg-basics",
      },
      {
        slug: "policy-basics",
        status: "planned",
        title: "Policies",
        intent: "Read a policy",
        difficulty: 2,
        depth: "overview",
        position: 1,
        track: "rls-basics",
      },
    ]);
  });

  it("writes the dependencies, including one reaching back a module", async () => {
    await run({ "CURRICULUM.md": PLANNED });

    expect(await edges()).toEqual([
      { lesson: "indexes", prereq: "query-plans" },
      { lesson: "policy-basics", prereq: "indexes" },
    ]);
  });

  it("revises rather than doubles on a second run", async () => {
    await run({ "CURRICULUM.md": PLANNED });
    await run({
      "CURRICULUM.md": PLANNED.replace(
        "| 3          | working  | query-plans |",
        "| 4          | deep dive | query-plans |",
      ),
    });

    const rows = await planned();
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.slug === "indexes")).toMatchObject({
      difficulty: 4,
      depth: "deep_dive",
    });
  });

  it("deletes a planned lesson the revision dropped from a module it rewrote", async () => {
    // Nothing is lost: there is no file behind it, and a stale row would be
    // counted forever in a fraction it no longer belongs to.
    await run({ "CURRICULUM.md": PLANNED });
    await run({
      "CURRICULUM.md": PLANNED.replace(
        "| indexes     | Indexes      | Pick one        | 3          | working  | query-plans |\n",
        "",
      ),
    });

    expect((await planned()).map((r) => r.slug)).toEqual(["query-plans", "policy-basics"]);
  });

  it("leaves a module the revision never reached alone", async () => {
    // A run that stopped halfway through writing the file has decided nothing
    // about the modules it never got to.
    await run({ "CURRICULUM.md": PLANNED });
    const truncated = PLANNED.slice(0, PLANNED.indexOf("## Module: rls-basics"));
    await run({ "CURRICULUM.md": truncated });

    expect((await planned()).map((r) => r.slug)).toContain("policy-basics");
  });

  it("never rewrites a lesson that already has a file", async () => {
    // The file owns what a lesson is; the plan owns why it is there. A revision
    // that renamed a lesson somebody has already read would make their own
    // library disagree with itself.
    await run({ "CURRICULUM.md": PLANNED });
    await db.$executeRawUnsafe(
      `update lessons set status = 'generated', seq = 1, storage_path = 'lessons/0001-query-plans.html',
         content_hash = 'sha', title = 'Query plans, in anger', completed_at = now(),
         outcome = 'understood'
       where mission_id = $1::uuid and slug = 'query-plans'`,
      missionId,
    );

    await run({
      "CURRICULUM.md": PLANNED.replace(
        "| query-plans | Query plans  |",
        "| query-plans | Renamed      |",
      ),
    });

    const [row] = await db.$queryRawUnsafe<
      { title: string; status: string; completed_at: Date | null; intent: string }[]
    >(
      `select title, status, completed_at, intent from lessons
        where mission_id = $1::uuid and slug = 'query-plans'`,
      missionId,
    );
    expect(row).toMatchObject({ title: "Query plans, in anger", status: "generated" });
    expect(row!.completed_at).not.toBeNull();
    // The plan half of the row is still revisable — that is what it owns.
    expect(row!.intent).toBe("Read one aloud");
  });

  it("keeps a written lesson the plan stopped mentioning", async () => {
    await run({ "CURRICULUM.md": PLANNED });
    await db.$executeRawUnsafe(
      `update lessons set status = 'generated', seq = 2, storage_path = 'lessons/0002-indexes.html',
         content_hash = 'sha'
       where mission_id = $1::uuid and slug = 'indexes'`,
      missionId,
    );

    await run({
      "CURRICULUM.md": PLANNED.replace(
        "| indexes     | Indexes      | Pick one        | 3          | working  | query-plans |\n",
        "",
      ),
    });

    expect((await planned()).map((r) => r.slug)).toContain("indexes");
  });

  it("keeps indexing lessons when a module table will not parse", async () => {
    const result = await run({
      "CURRICULUM.md": `${PLANNED}\n## Module: pg-basics\n\nprose, not a table\n`,
      "lessons/0009-x.html": LESSON,
    });

    expect(result.lessons).toBe(1);
    expect(result.plannedLessons).toBe(3);
  });
});

/**
 * A written lesson claiming its plan entry (§3.2b).
 *
 * The failure this prevents is not visible in either row on its own: the lesson
 * is fine, the plan entry is fine, and the module quietly owes a lesson it has
 * already been taught. Every test here is about the two staying one row.
 */
describe("claiming a plan entry", () => {
  const PLANNED = `# Curriculum

## Tracks

| Order | Slug      | Track           | Prerequisites |
| ----- | --------- | --------------- | ------------- |
| 1     | pg-basics | Postgres basics | —             |

## Module: pg-basics

| Slug        | Lesson      | Intent         | Difficulty | Depth   | Depends on |
| ----------- | ----------- | -------------- | ---------- | ------- | ---------- |
| query-plans | Query plans | Read one aloud | 2          | working | —          |
`;

  const CLAIMING = `<html><head><title>Query plans, at last</title>
    <meta name="mindforge:track" content="pg-basics" />
    <meta name="mindforge:lesson" content="query-plans" />
    </head><body><p>Hi</p></body></html>`;

  async function lessons() {
    return db.$queryRawUnsafe<
      { slug: string; status: string; title: string; intent: string | null; seq: number | null }[]
    >(
      `select slug, status, title, intent, seq from lessons where mission_id = $1::uuid`,
      missionId,
    );
  }

  it("fills the planned row in rather than adding a second one", async () => {
    await run({ "CURRICULUM.md": PLANNED });
    await run({ "lessons/0001-query-plans.html": CLAIMING });

    expect(await lessons()).toEqual([
      {
        slug: "query-plans",
        status: "generated",
        title: "Query plans, at last",
        // The plan's half of the row survives the claim: it is what the module
        // ordered the lesson by, and the file never carried it.
        intent: "Read one aloud",
        seq: 1,
      },
    ]);
  });

  it("keeps the edges that pointed at the plan entry", async () => {
    // The claim must not be a delete-and-insert: `lesson_edges` points at the row
    // id, and a new row would unlock everything that was waiting on this lesson.
    const withSecond = `${PLANNED}| indexes     | Indexes     | Pick one       | 3          | working | query-plans |\n`;
    await run({ "CURRICULUM.md": withSecond });
    await run({ "lessons/0001-query-plans.html": CLAIMING });

    const edges = await db.$queryRawUnsafe<{ lesson: string; prereq: string }[]>(
      `select l.slug as lesson, p.slug as prereq from lesson_edges e
         join lessons l on l.id = e.lesson_id
         join lessons p on p.id = e.prereq_id
        where l.mission_id = $1::uuid`,
      missionId,
    );
    expect(edges).toEqual([{ lesson: "indexes", prereq: "query-plans" }]);
  });

  it("keeps the claim stable when the same lesson is reindexed", async () => {
    // The second run finds no planned row to claim — it has already been claimed —
    // and must not fall back to filing the lesson under its filename slug, which
    // would detach it from the plan it is part of.
    await run({ "CURRICULUM.md": PLANNED });
    await run({ "lessons/0001-something-else.html": CLAIMING });
    await run({ "lessons/0001-something-else.html": CLAIMING });

    const rows = await lessons();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: "query-plans", status: "generated" });
  });

  it("re-attaches a rebuilt lesson to its plan entry", async () => {
    // Files are canonical and Postgres is a rebuildable index (non-negotiable 5).
    // A row deleted and re-read from Storage has to land back on the plan rather
    // than beside it.
    await run({ "CURRICULUM.md": PLANNED });
    await run({ "lessons/0001-query-plans.html": CLAIMING });
    await db.$executeRawUnsafe(`delete from lessons where mission_id = $1::uuid`, missionId);

    await run({ "lessons/0001-query-plans.html": CLAIMING });
    await run({ "CURRICULUM.md": PLANNED });

    const rows = await lessons();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: "query-plans", intent: "Read one aloud" });
  });

  it("writes a lesson that claims nothing as its own row", async () => {
    // Off-plan is legal and permanent. It joins the module and the module's
    // denominator; it just does not consume a plan entry.
    await run({ "CURRICULUM.md": PLANNED });
    await run({
      "lessons/0002-detour.html": `<html><head><title>A detour</title>
        <meta name="mindforge:track" content="pg-basics" />
        </head><body><p>Hi</p></body></html>`,
    });

    const rows = await lessons();
    expect(rows.map((r) => r.slug).sort()).toEqual(["detour", "query-plans"]);
  });

  it("does not claim a plan entry that does not exist", async () => {
    await run({ "CURRICULUM.md": PLANNED });
    await run({
      "lessons/0003-ghost.html": `<html><head><title>Ghost</title>
        <meta name="mindforge:lesson" content="never-planned" />
        </head><body><p>Hi</p></body></html>`,
    });

    const rows = await lessons();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.slug === "never-planned")).toMatchObject({ status: "generated" });
    expect(rows.find((r) => r.slug === "query-plans")).toMatchObject({ status: "planned" });
  });
});
