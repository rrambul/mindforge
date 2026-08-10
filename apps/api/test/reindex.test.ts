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
  // Resources too. They belong to the user rather than the mission, so deleting
  // missions leaves them behind — and a title left over from an earlier test then
  // matches the upsert key, turning a create into an update.
  await db.$executeRawUnsafe(`delete from missions where user_id = $1::uuid`, alice.id);
  await db.$executeRawUnsafe(`delete from resources where user_id = $1::uuid`, alice.id);
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

describe("RESOURCES.md", () => {
  const RESOURCES = `# Resources

## Primary Sources

| Resource | Type | Trust | Why it's here |
| -------- | ---- | ----- | ------------- |
| [The Rust Book](https://doc.rust-lang.org/book/) | docs | high | Canonical |

## Explored But Rejected

- [Rust in 5 Minutes](https://example.com/quick) — Too shallow
`;

  it("adds what the agent found to the library", async () => {
    const result = await run({ "RESOURCES.md": RESOURCES });

    expect(result.resources).toBe(2);
    const rows = await db.$queryRawUnsafe<
      { title: string; trust: string | null; status: string }[]
    >(
      `select title, trust, status from resources where user_id = $1::uuid order by title`,
      alice.id,
    );
    expect(rows).toEqual([
      { title: "Rust in 5 Minutes", trust: null, status: "reference" },
      { title: "The Rust Book", trust: "high", status: "inbox" },
    ]);
  });

  it("does not double the library on a second run", async () => {
    // The defect this whole path was deferred a commit to avoid. `resources` has
    // no natural unique constraint and the agent rewrites the file wholesale, so
    // without an upsert key the library doubles every run.
    await run({ "RESOURCES.md": RESOURCES });
    await run({ "RESOURCES.md": RESOURCES });

    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from resources where user_id = $1::uuid`,
      alice.id,
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it("does not reset a book the learner marked finished", async () => {
    // The most damaging thing this path could do. `RESOURCES.md` has no status
    // column and the database defaults to `inbox`, so a naive write undoes the
    // learner's own record of having read something — on every run, forever.
    await run({ "RESOURCES.md": RESOURCES });
    await db.$executeRawUnsafe(
      `update resources set status = 'finished', finished_at = now(),
         progress = '{"unit":"percent","current":100}'::jsonb
        where user_id = $1::uuid and title = 'The Rust Book'`,
      alice.id,
    );

    await run({ "RESOURCES.md": RESOURCES });

    const rows = await db.$queryRawUnsafe<
      { status: string; finished_at: Date | null; progress: unknown }[]
    >(
      `select status, finished_at, progress from resources
        where user_id = $1::uuid and title = 'The Rust Book'`,
      alice.id,
    );
    expect(rows[0]).toMatchObject({ status: "finished" });
    expect(rows[0]!.finished_at).not.toBeNull();
    expect(rows[0]!.progress).toEqual({ unit: "percent", current: 100 });
  });

  it("updates the fields the file does represent", async () => {
    await run({ "RESOURCES.md": RESOURCES });
    await run({
      "RESOURCES.md": RESOURCES.replace("| docs | high |", "| book | medium |"),
    });

    const rows = await db.$queryRawUnsafe<{ type: string; trust: string }[]>(
      `select type, trust from resources where user_id = $1::uuid and title = 'The Rust Book'`,
      alice.id,
    );
    expect(rows[0]).toMatchObject({ type: "book", trust: "medium" });
  });

  it("links what it creates to the mission that found it", async () => {
    // FR-T8: sources the agent finds appear in your library, and the library is
    // scoped by mission.
    await run({ "RESOURCES.md": RESOURCES });

    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from resource_links where mission_id = $1::uuid`,
      missionId,
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it("writes the rejected reason and never the abandon reason", async () => {
    // Two columns for two different events. The agent's verdict on something
    // nobody started is not the learner's guilt-free quit (FR-R5), and conflating
    // them invents an abandonment that never happened.
    await run({ "RESOURCES.md": RESOURCES });

    const rows = await db.$queryRawUnsafe<
      { rejected_reason: string | null; abandon_reason: string | null }[]
    >(
      `select rejected_reason, abandon_reason from resources
        where user_id = $1::uuid and title = 'Rust in 5 Minutes'`,
      alice.id,
    );
    expect(rows[0]).toEqual({ rejected_reason: "Too shallow", abandon_reason: null });
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

## Skills

| Track      | Skill slug      | Skill                 |
| ---------- | --------------- | --------------------- |
| rls-basics | rls-read-policy | Read an RLS policy    |
`;

  const TAGGED = `<html><head><title>Policies</title>
    <meta name="mindforge:track" content="rls-basics" />
    <meta name="mindforge:skill" content="rls-read-policy" />
    </head><body><p>Hi</p></body></html>`;

  async function tracks() {
    return db.$queryRawUnsafe<{ slug: string; position: number; status: string }[]>(
      `select slug, position, status from tracks where mission_id = $1::uuid order by position`,
      missionId,
    );
  }

  beforeEach(async () => {
    // Skills belong to the user rather than the mission, so deleting missions
    // leaves them behind — and a slug left over from an earlier test is then
    // adopted rather than created, which is correct behaviour and the wrong
    // starting state for a test about creation.
    await db.$executeRawUnsafe(`delete from skills where user_id = $1::uuid`, alice.id);
  });

  it("writes tracks, their prerequisites and their skills", async () => {
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

    const [link] = await db.$queryRawUnsafe<{ track: string; skill: string }[]>(
      `select t.slug as track, s.slug as skill from track_skills ts
         join tracks t on t.id = ts.track_id
         join skills s on s.id = ts.skill_id
        where t.mission_id = $1::uuid`,
      missionId,
    );
    expect(link).toEqual({ track: "rls-basics", skill: "rls-read-policy" });
  });

  it("creates the skill unproven — no score, no band above the default", async () => {
    // The interface `SyncCurriculumSkills` writes through cannot express these,
    // and this is where that stops being a claim about a type. A generated
    // curriculum asserting a score would make FR-S5's calibration gap measure a
    // model's guess against the learner's, which is not what it means.
    await run({ "CURRICULUM.md": CURRICULUM });

    const [skill] = await db.$queryRawUnsafe<
      { score: string | null; band: string; perceived_level: string | null }[]
    >(
      `select score::text, band, perceived_level::text from skills
        where user_id = $1::uuid and slug = 'rls-read-policy'`,
      alice.id,
    );

    // Null, not zero: unproven is a different and truer claim than "scored zero".
    expect(skill).toEqual({ score: null, band: "aware", perceived_level: null });
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

  it("files a lesson under its module and credits the skill it names", async () => {
    // The join `lessons.outcome` has been waiting for since M0. Without it, FR-T9's
    // "first automatic skill evidence" has no target — the column exists, the
    // evidence kind exists, and nothing connects a lesson to a skill.
    await run({ "CURRICULUM.md": CURRICULUM, "lessons/0001-policies.html": TAGGED });

    const [row] = await db.$queryRawUnsafe<{ track: string; skill: string }[]>(
      `select t.slug as track, s.slug as skill from lessons l
         join tracks t on t.id = l.track_id
         join lesson_skills ls on ls.lesson_id = l.id
         join skills s on s.id = ls.skill_id
        where l.mission_id = $1::uuid`,
      missionId,
    );

    expect(row).toEqual({ track: "rls-basics", skill: "rls-read-policy" });
  });

  it("re-files a lesson that changed which skill it teaches", async () => {
    // Rebuilt from the file rather than added to. A lesson the agent revised must
    // not keep crediting the skill it used to teach: the outcome becomes evidence
    // through this join, so a stale row is evidence attributed to the wrong skill.
    const withSecondSkill = CURRICULUM.replace(
      "| rls-basics | rls-read-policy | Read an RLS policy    |\n",
      "| rls-basics | rls-read-policy | Read an RLS policy    |\n" +
        "| rls-basics | rls-write-policy | Write an RLS policy  |\n",
    );
    await run({ "CURRICULUM.md": withSecondSkill, "lessons/0001-policies.html": TAGGED });

    await run({
      "CURRICULUM.md": withSecondSkill,
      "lessons/0001-policies.html": TAGGED.replace("rls-read-policy", "rls-write-policy"),
    });

    const rows = await db.$queryRawUnsafe<{ skill: string }[]>(
      `select s.slug as skill from lessons l
         join lesson_skills ls on ls.lesson_id = l.id
         join skills s on s.id = ls.skill_id
        where l.mission_id = $1::uuid`,
      missionId,
    );

    expect(rows.map((r) => r.skill)).toEqual(["rls-write-policy"]);
  });

  it("adopts a skill the learner already has rather than forking it", async () => {
    // `skills` is unique on `(user_id, slug)`, not on `(mission_id, slug)`. You
    // learn a thing once — a second row would dilute one skill's evidence across
    // two, silently and in the direction of a lower score.
    await db.$executeRawUnsafe(
      `insert into skills (id, user_id, name, slug, band, score)
       values (gen_random_uuid(), $1::uuid, 'Reading policies', 'rls-read-policy', 'working', 61)`,
      alice.id,
    );

    await run({ "CURRICULUM.md": CURRICULUM });

    const rows = await db.$queryRawUnsafe<{ name: string; score: string | null }[]>(
      `select name, score::text from skills where user_id = $1::uuid and slug = 'rls-read-policy'`,
      alice.id,
    );

    expect(rows).toHaveLength(1);
    // Renamed, because the curriculum's wording is the newer one — and the score
    // untouched, because nothing about a curriculum is evidence.
    expect(rows[0]).toEqual({ name: "Read an RLS policy", score: "61.00" });
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
