import type { PrismaClient } from "@mindforge/db";
import { renderBriefing, type BriefingInput, type CurrentTrack } from "@mindforge/workspace";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BRIEFING_READER,
  type BriefingReader,
} from "../src/modules/teach/application/briefing.port.js";
import { ReindexWorkspace } from "../src/modules/teach/application/reindex-workspace.js";
import { adminDb, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * What the agent is told to write next, against real rows (FR-K7).
 *
 * The rendering is pinned by a unit test on pure input. This is the half that
 * unit test cannot see: whether the rows and edges Postgres holds produce the
 * right *target*. Getting it wrong here is silent — the briefing still reads
 * perfectly, and the agent writes a lesson the learner cannot follow yet.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let reindex: ReindexWorkspace;
let reader: BriefingReader;
let missionId: string;

const encoder = new TextEncoder();

const CURRICULUM = `# Curriculum

## Tracks

| Order | Slug       | Track            | Outcome       | Prerequisites |
| ----- | ---------- | ---------------- | ------------- | ------------- |
| 1     | pg-basics  | Postgres basics  | Read a plan   | —             |
| 2     | rls-basics | RLS fundamentals | Read a policy | pg-basics     |

## Module: pg-basics

| Slug        | Lesson      | Intent         | Difficulty | Depth   | Depends on  |
| ----------- | ----------- | -------------- | ---------- | ------- | ----------- |
| query-plans | Query plans | Read one aloud | 2          | working | —           |
| indexes     | Indexes     | Pick one       | 1          | working | query-plans |

## Module: rls-basics

| Slug          | Lesson   | Intent        | Difficulty | Depth    | Depends on |
| ------------- | -------- | ------------- | ---------- | -------- | ---------- |
| policy-basics | Policies | Read a policy | 3          | overview | indexes    |
`;

function run(files: Record<string, string>) {
  return reindex.execute({
    userId: alice.id,
    missionId,
    files: new Map(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)])),
    deleted: [],
    timezone: "UTC",
  });
}

async function open(slug: string) {
  await db.$executeRawUnsafe(
    `update tracks set status = 'active' where mission_id = $1::uuid and slug = $2`,
    missionId,
    slug,
  );
}

async function gather(): Promise<BriefingInput> {
  return reader.gather(alice.id, missionId);
}

/** The open module, or a failure naming what came back instead. */
function moduleOf(input: BriefingInput): CurrentTrack {
  if ("status" in input.currentTrack) {
    throw new Error(`expected an open module, got: ${input.currentTrack.reason}`);
  }
  return input.currentTrack;
}

beforeAll(async () => {
  app = await bootApp();
  db = adminDb();
  alice = await signUp();
  reindex = app.get(ReindexWorkspace, { strict: false });
  reader = app.get<BriefingReader>(BRIEFING_READER, { strict: false });
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
  await run({ "CURRICULUM.md": CURRICULUM });
});

describe("the plan in the briefing", () => {
  it("names the first unblocked lesson, not the easiest one", async () => {
    // `indexes` is difficulty 1 and `query-plans` is 2, so it sorts first in the
    // module — and a briefing that read the order as the answer would send the
    // agent to write the lesson the learner cannot follow yet. Dependencies gate;
    // difficulty only orders.
    await open("pg-basics");
    const module = moduleOf(await gather());

    expect(module.plan.map((l) => l.slug)).toEqual(["indexes", "query-plans"]);
    expect(module.nextLesson).toMatchObject({ slug: "query-plans", intent: "Read one aloud" });
  });

  it("moves on once the first lesson is finished", async () => {
    await open("pg-basics");
    await db.$executeRawUnsafe(
      `update lessons set status = 'generated', seq = 1, storage_path = 'lessons/0001-q.html',
         content_hash = 'sha', completed_at = now(), outcome = 'understood'
       where mission_id = $1::uuid and slug = 'query-plans'`,
      missionId,
    );

    expect(moduleOf(await gather()).nextLesson).toMatchObject({ slug: "indexes" });
  });

  it("sees a lock reaching back into an earlier module", async () => {
    // The reason the reader loads the whole mission rather than the open track: a
    // query scoped to this module would find no prerequisite row and call
    // `policy-basics` unblocked.
    await open("rls-basics");

    const module = moduleOf(await gather());
    expect(module.nextLesson).toBeNull();
    expect(module.plan[0]).toMatchObject({
      slug: "policy-basics",
      unblocked: false,
      blockedBy: ["Indexes"],
    });
  });

  it("unlocks across the module boundary once the earlier lesson is done", async () => {
    await open("rls-basics");
    await db.$executeRawUnsafe(
      `update lessons set status = 'generated', seq = 2, storage_path = 'lessons/0002-i.html',
         content_hash = 'sha', completed_at = now()
       where mission_id = $1::uuid and slug = 'indexes'`,
      missionId,
    );

    expect(moduleOf(await gather()).nextLesson).toMatchObject({ slug: "policy-basics" });
  });

  it("never names a lesson that has already been written", async () => {
    // It would claim a plan entry describing a different lesson. In M5 the app
    // says "read this" instead; here the only verb is "teach".
    await open("pg-basics");
    await db.$executeRawUnsafe(
      `update lessons set status = 'generated', seq = 1, storage_path = 'lessons/0001-q.html',
         content_hash = 'sha'
       where mission_id = $1::uuid and slug = 'query-plans'`,
      missionId,
    );

    const module = moduleOf(await gather());
    expect(module.nextLesson).toBeNull();
    expect(module.plan.find((l) => l.slug === "query-plans")).toMatchObject({ written: true });
  });

  it("renders both meta tags into the file the agent reads", async () => {
    await open("pg-basics");
    const briefing = renderBriefing(await gather());

    expect(briefing).toContain('<meta name="mindforge:track" content="pg-basics">');
    expect(briefing).toContain('<meta name="mindforge:lesson" content="query-plans">');
  });

  it("does not list a planned lesson among the ones already written", async () => {
    // "Lessons already in this module" is what stops the agent repeating one.
    // A planned row there would be a claim that a lesson exists when the module
    // is precisely still owed it.
    await open("pg-basics");

    expect(moduleOf(await gather()).lessons).toEqual([]);
  });

  it("falls back to the pre-plan instruction for a module with no plan", async () => {
    await db.$executeRawUnsafe(`delete from lessons where mission_id = $1::uuid`, missionId);
    await open("pg-basics");

    const briefing = renderBriefing(await gather());
    expect(briefing).toContain("This module has no planned lessons yet");
  });
});

/**
 * How the finished lessons landed (FR-P1, FR-T3).
 *
 * Real data since M5. Until the in-app reader shipped this section carried a
 * sentence saying no completion signal existed, and §7.3b promised the day it
 * became real would be a deletion — these are the tests that hold what replaced
 * it. The failure they rule out is the one that section was written against: a
 * briefing that implies the learner has completed nothing when the truth is that
 * nobody looked.
 */
describe("what the briefing says about finished lessons", () => {
  async function finish(slug: string, seq: number, outcome: string | null): Promise<void> {
    await db.$executeRawUnsafe(
      `update lessons set status = 'generated', seq = $3::int,
         storage_path = 'lessons/000' || $3 || '-x.html', content_hash = 'sha',
         completed_at = now() - ($3::int || ' hours')::interval, outcome = $4
       where mission_id = $1::uuid and slug = $2`,
      missionId,
      slug,
      seq,
      outcome,
    );
  }

  it("says nothing is finished, in words rather than as a zero", async () => {
    await open("pg-basics");

    const briefing = renderBriefing(await gather());
    expect(briefing).toContain("No lesson has been marked finished yet");
    expect(briefing).toContain("empty result rather than a missing signal");
  });

  it("lists each finished lesson with how it landed, newest first", async () => {
    await open("pg-basics");
    await finish("query-plans", 1, "understood");
    await finish("indexes", 2, "shaky");

    const briefing = renderBriefing(await gather());

    expect(briefing).toContain("0001 Query plans — understood");
    expect(briefing).toContain("0002 Indexes — shaky");
    // Newest first: `query-plans` was completed one hour ago and `indexes` two.
    expect(briefing.indexOf("Query plans — understood")).toBeLessThan(
      briefing.indexOf("Indexes — shaky"),
    );
  });

  it("says a completion with no outcome was not recorded rather than dropping it", async () => {
    // M4 wrote rows like this, and the reader cannot retroactively ask how they
    // went. Dropping them would understate what the learner has done; guessing an
    // outcome would be worse.
    await open("pg-basics");
    await finish("query-plans", 1, null);

    expect(renderBriefing(await gather())).toContain(
      "0001 Query plans — finished, outcome not recorded",
    );
  });

  it("does not list a lesson that was never finished", async () => {
    await open("pg-basics");
    await db.$executeRawUnsafe(
      `update lessons set status = 'generated', seq = 1, storage_path = 'lessons/0001-q.html',
         content_hash = 'sha'
       where mission_id = $1::uuid and slug = 'query-plans'`,
      missionId,
    );

    const briefing = renderBriefing(await gather());
    expect(briefing).toContain("No lesson has been marked finished yet");
  });
});
