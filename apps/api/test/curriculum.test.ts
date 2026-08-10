import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CurriculumView } from "../src/modules/curriculum/application/get-curriculum.js";
import { ReindexWorkspace } from "../src/modules/teach/application/reindex-workspace.js";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * The curriculum screen's read side, over HTTP (FR-K5, FR-K6, FR-K7).
 *
 * Every field this route returns is derived at the moment it is asked for, so the
 * failures it can have are all of one kind: a number that is wrong but plausible.
 * A locked lesson shown as available, a badge on a lesson nothing depends on, a
 * fraction whose denominator quietly grew. Each test names the wrong answer.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;
let reindex: ReindexWorkspace;
let missionId: string;

const encoder = new TextEncoder();

const CURRICULUM = `# Curriculum

## Tracks

| Order | Slug       | Track            | Outcome       | Prerequisites |
| ----- | ---------- | ---------------- | ------------- | ------------- |
| 1     | pg-basics  | Postgres basics  | Read a plan   | —             |
| 2     | rls-basics | RLS fundamentals | Read a policy | pg-basics     |

## Module: pg-basics

| Slug        | Lesson      | Intent         | Difficulty | Depth     | Depends on  |
| ----------- | ----------- | -------------- | ---------- | --------- | ----------- |
| query-plans | Query plans | Read one aloud | 2          | working   | —           |
| indexes     | Indexes     | Pick one       | 4          | deep dive | query-plans |

## Module: rls-basics

| Slug          | Lesson   | Intent        | Difficulty | Depth    | Depends on  |
| ------------- | -------- | ------------- | ---------- | -------- | ----------- |
| policy-basics | Policies | Read a policy | 3          | overview | query-plans |
`;

function get(url: string, user: TestUser | null) {
  return app.inject({ method: "GET", url, headers: user ? bearer(user) : {} });
}

async function curriculum(user: TestUser = alice, id = missionId): Promise<CurriculumView> {
  const response = await get(`/v1/missions/${id}/curriculum`, user);
  expect(response.statusCode).toBe(200);
  return response.json<CurriculumView>();
}

function moduleNamed(view: CurriculumView, slug: string) {
  const found = view.modules.find((m) => m.slug === slug);
  if (!found) throw new Error(`no module ${slug} in ${view.modules.map((m) => m.slug).join(", ")}`);
  return found;
}

function lessonNamed(view: CurriculumView, slug: string) {
  const found = view.modules.flatMap((m) => m.lessons).find((l) => l.slug === slug);
  if (!found) throw new Error(`no lesson ${slug}`);
  return found;
}

async function complete(slug: string) {
  await db.$executeRawUnsafe(
    `update lessons set status = 'generated', seq = $3::int,
       storage_path = 'lessons/000' || $3 || '-x.html', content_hash = 'sha',
       completed_at = now(), outcome = 'understood'
     where mission_id = $1::uuid and slug = $2`,
    missionId,
    slug,
    slug.length,
  );
}

beforeAll(async () => {
  app = await bootApp();
  db = adminDb();
  alice = await signUp();
  bob = await signUp();
  reindex = app.get(ReindexWorkspace, { strict: false });
});

afterAll(async () => {
  await deleteUsers(db, [alice.id, bob.id]);
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

  await reindex.execute({
    userId: alice.id,
    missionId,
    files: new Map([["CURRICULUM.md", encoder.encode(CURRICULUM)]]),
    deleted: [],
    timezone: "UTC",
  });
});

describe("reading a curriculum", () => {
  it("returns the modules in order, each with its planned lessons", async () => {
    const view = await curriculum();

    expect(view.modules.map((m) => m.slug)).toEqual(["pg-basics", "rls-basics"]);
    expect(moduleNamed(view, "pg-basics").lessons.map((l) => l.slug)).toEqual([
      "query-plans",
      "indexes",
    ]);
    expect(lessonNamed(view, "indexes")).toMatchObject({
      title: "Indexes",
      intent: "Pick one",
      difficulty: 4,
      depth: "deep_dive",
      status: "planned",
    });
  });

  it("names the module's prerequisites in words a person can read", async () => {
    expect(moduleNamed(await curriculum(), "rls-basics").prerequisites).toEqual([
      "Postgres basics",
    ]);
  });

  it("counts how many lessons depend on each one, rather than flagging them", async () => {
    // FR-K6: fundamental is a count, so the UI can rank as well as badge. Two
    // lessons depend on `query-plans`, and one of them is in another module.
    const view = await curriculum();

    expect(lessonNamed(view, "query-plans").dependentCount).toBe(2);
    expect(lessonNamed(view, "indexes").dependentCount).toBe(0);
  });

  it("locks a lesson until its prerequisite is finished, and says which", async () => {
    const before = await curriculum();
    expect(lessonNamed(before, "indexes")).toMatchObject({
      unblocked: false,
      blockedBy: ["Query plans"],
    });

    await complete("query-plans");

    const after = await curriculum();
    expect(lessonNamed(after, "indexes")).toMatchObject({ unblocked: true, blockedBy: [] });
  });

  it("unlocks across a module boundary too", async () => {
    // The reason the whole mission is read at once: a query scoped per module
    // would find no prerequisite row and call this available from the start.
    expect(lessonNamed(await curriculum(), "policy-basics").unblocked).toBe(false);

    await complete("query-plans");

    expect(lessonNamed(await curriculum(), "policy-basics").unblocked).toBe(true);
  });

  it("names the next lesson as the first unblocked one, not the first listed", async () => {
    const view = await curriculum();
    expect(view.nextLessonId).toBe(lessonNamed(view, "query-plans").id);

    await complete("query-plans");

    const after = await curriculum();
    // `policy-basics` is difficulty 3 and unblocked, but it is in a later module.
    expect(after.nextLessonId).toBe(lessonNamed(after, "indexes").id);
  });

  it("counts progress over the module as it now stands", async () => {
    expect(moduleNamed(await curriculum(), "pg-basics").progress).toEqual({
      completed: 0,
      total: 2,
    });

    await complete("query-plans");

    expect(moduleNamed(await curriculum(), "pg-basics").progress).toEqual({
      completed: 1,
      total: 2,
    });
  });

  it("returns null progress for a module with no lessons, never a zero", async () => {
    // Non-negotiable 10: a 0/0 rendered as a bar is a claim that something was
    // measured. This module has no plan yet, and the screen has to say so.
    await db.$executeRawUnsafe(
      `delete from lessons where mission_id = $1::uuid and slug = any($2::text[])`,
      missionId,
      ["query-plans", "indexes"],
    );

    expect(moduleNamed(await curriculum(), "pg-basics").progress).toBeNull();
  });

  it("carries the completion and its outcome once one exists", async () => {
    await complete("query-plans");

    expect(lessonNamed(await curriculum(), "query-plans")).toMatchObject({
      status: "generated",
      completed: true,
      outcome: "understood",
    });
  });

  it("hides a dropped module that holds nothing, and keeps one that holds a lesson", async () => {
    // A dropped module is one a regenerated curriculum stopped mentioning. Hiding
    // it either way would make finished work disappear from the only screen
    // listing it.
    await db.$executeRawUnsafe(
      `update tracks set status = 'dropped' where mission_id = $1::uuid`,
      missionId,
    );

    expect((await curriculum()).modules).toEqual([]);

    await complete("policy-basics");

    expect((await curriculum()).modules.map((m) => m.slug)).toEqual(["rls-basics"]);
  });

  it("gives another user's mission the same answer as one that does not exist", async () => {
    // "It exists but is not yours" is itself worth not leaking.
    const mine = await get(`/v1/missions/${missionId}/curriculum`, bob);
    const nobody = await get("/v1/missions/00000000-0000-4000-8000-000000000000/curriculum", bob);

    expect(mine.statusCode).toBe(404);
    expect(nobody.statusCode).toBe(404);
  });

  it("refuses an unauthenticated read", async () => {
    expect((await get(`/v1/missions/${missionId}/curriculum`, null)).statusCode).toBe(401);
  });
});
