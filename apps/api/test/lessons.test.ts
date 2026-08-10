import { verifyViewToken } from "@mindforge/core";
import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { LessonView } from "../src/modules/lessons/presentation/lesson.view.js";
import type {
  LearningRecordResponse,
  ReferenceDocResponse,
} from "../src/modules/lessons/presentation/library.controller.js";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * The reader, over HTTP (FR-T5, FR-P1, FR-T6).
 *
 * Two kinds of failure are worth the real stack here. The first is a view URL that
 * grants the wrong thing — checked by verifying the minted token the way
 * `apps/lessons` does, because a URL that merely *looks* right is exactly what a
 * mistake in the prefix produces. The second is isolation: every route below is
 * asked for with Bob's token as well as Alice's, since RLS is the only thing
 * standing between the two and it is enforced in Postgres rather than in the code
 * under test.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;
let missionId: string;
let lessonId: string;
let plannedId: string;

const WORKSPACE_KEY = "rust-ownership";
const SECRET = process.env["LESSONS_TOKEN_SECRET"] ?? "";

function get(url: string, user: TestUser | null) {
  return app.inject({ method: "GET", url, headers: user ? bearer(user) : {} });
}

async function lesson(id = lessonId, user: TestUser = alice): Promise<LessonView> {
  const response = await get(`/v1/lessons/${id}`, user);
  expect(response.statusCode).toBe(200);
  return response.json<LessonView>();
}

function complete(id: string, outcome: string, user: TestUser = alice) {
  return app.inject({
    method: "PUT",
    url: `/v1/lessons/${id}/completion`,
    headers: bearer(user),
    payload: { outcome },
  });
}

beforeAll(async () => {
  app = await bootApp();
  db = adminDb();
  alice = await signUp();
  bob = await signUp();
});

afterAll(async () => {
  await deleteUsers(db, [alice.id, bob.id]);
  await app.close();
  await db.$disconnect();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`delete from missions where user_id = $1::uuid`, alice.id);

  const [mission] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'Rust ownership', 'active', $2, now(), now())
     returning id`,
    alice.id,
    WORKSPACE_KEY,
  );
  missionId = mission!.id;

  const [track] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into tracks (id, user_id, mission_id, slug, name, outcome, position, status,
       created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, 'ownership', 'Ownership in practice',
       'Explain a move', 1, 'active', now(), now())
     returning id`,
    alice.id,
    missionId,
  );

  const [written] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into lessons (id, user_id, mission_id, track_id, status, seq, slug, title,
       storage_path, content_hash, difficulty, depth, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'generated', 7, 'borrow-checker',
       'Borrow checker errors', $4, 'sha', 4, 'deep_dive', now(), now())
     returning id`,
    alice.id,
    missionId,
    track!.id,
    `workspaces/${alice.id}/${WORKSPACE_KEY}/lessons/0007-borrow-checker.html`,
  );
  lessonId = written!.id;

  const [planned] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into lessons (id, user_id, mission_id, track_id, status, slug, title, intent,
       difficulty, depth, position, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'planned', 'lifetimes',
       'Lifetimes', 'Name one', 5, 'working', 2, now(), now())
     returning id`,
    alice.id,
    missionId,
    track!.id,
  );
  plannedId = planned!.id;
});

describe("GET /v1/lessons/:id", () => {
  it("mints a grant the lessons origin would accept, for this workspace only", async () => {
    const view = await lesson();
    const url = new URL(view.view!.url);
    const [, , token, ...rest] = url.pathname.split("/");

    const grant = await verifyViewToken(token!, SECRET, Math.floor(Date.now() / 1000));

    // The prefix is the whole of the ownership decision, so it is asserted whole.
    expect(grant?.prefix).toBe(`workspaces/${alice.id}/${WORKSPACE_KEY}`);
    expect(rest.join("/")).toBe("lessons/0007-borrow-checker.html");
  });

  it("carries the chrome the reader shows around the frame", async () => {
    const view = await lesson();

    expect(view).toMatchObject({
      title: "Borrow checker errors",
      moduleName: "Ownership in practice",
      status: "generated",
      difficulty: 4,
      depth: "deep_dive",
      outcome: null,
      completedAt: null,
    });
  });

  it("is never cached — the URL it returns stops working", async () => {
    // A cached response outliving its grant is a reader showing a blank frame with
    // nothing to say about why.
    const response = await get(`/v1/lessons/${lessonId}`, alice);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("offers nothing to open for a lesson that is only planned", async () => {
    const view = await lesson(plannedId);
    expect(view.view).toBeNull();
    expect(view.status).toBe("planned");
  });

  it("404s another user's lesson, the same as one that does not exist", async () => {
    expect((await get(`/v1/lessons/${lessonId}`, bob)).statusCode).toBe(404);
    expect((await get(`/v1/lessons/00000000-0000-4000-8000-000000000000`, alice)).statusCode).toBe(
      404,
    );
  });

  it("401s without a token", async () => {
    expect((await get(`/v1/lessons/${lessonId}`, null)).statusCode).toBe(401);
  });
});

describe("PUT /v1/lessons/:id/completion", () => {
  it("records the outcome, and the curriculum's fraction moves with it", async () => {
    const response = await complete(lessonId, "shaky");
    expect(response.statusCode).toBe(200);
    expect(response.json<LessonView>()).toMatchObject({ outcome: "shaky" });

    // The fraction is the reason the outcome exists, so it is asserted through the
    // screen that shows it rather than by reading the column back.
    const curriculum = await get(`/v1/missions/${missionId}/curriculum`, alice);
    expect(curriculum.json<{ modules: { progress: unknown }[] }>().modules[0]!.progress).toEqual({
      completed: 1,
      total: 2,
    });
  });

  it("is idempotent, and re-completing revises rather than appends", async () => {
    await complete(lessonId, "lost");
    const again = await complete(lessonId, "understood");

    expect(again.json<LessonView>().outcome).toBe("understood");

    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from lessons where mission_id = $1::uuid and completed_at is not null`,
      missionId,
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("refuses an outcome that is not one of the three", async () => {
    expect((await complete(lessonId, "done")).statusCode).toBe(422);
  });

  it("refuses a lesson with no content to have understood", async () => {
    // 409 rather than the check constraint's 500: the reader turns this into
    // "have it taught first", which is an action rather than an apology.
    const response = await complete(plannedId, "understood");
    expect(response.statusCode).toBe(409);
    expect(response.json<{ type: string }>().type).toContain("lesson-not-written");
  });

  it("does not complete another user's lesson", async () => {
    expect((await complete(lessonId, "understood", bob)).statusCode).toBe(404);

    const rows = await db.$queryRawUnsafe<{ completed_at: Date | null }[]>(
      `select completed_at from lessons where id = $1::uuid`,
      lessonId,
    );
    expect(rows[0]!.completed_at).toBeNull();
  });

  it("clears a mis-tap", async () => {
    await complete(lessonId, "lost");

    const cleared = await app.inject({
      method: "DELETE",
      url: `/v1/lessons/${lessonId}/completion`,
      headers: bearer(alice),
    });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<LessonView>()).toMatchObject({ outcome: null, completedAt: null });
  });
});

describe("the library (FR-T6)", () => {
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `insert into reference_docs (id, user_id, mission_id, slug, title, storage_path,
         content_hash, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $2::uuid, 'ownership', 'Ownership, in one page',
         $3, 'sha', now(), now())`,
      alice.id,
      missionId,
      `workspaces/${alice.id}/${WORKSPACE_KEY}/reference/ownership.html`,
    );

    await db.$executeRawUnsafe(
      `insert into learning_records (id, user_id, mission_id, seq, title, lesson_id, what_learned,
         evidence, key_insight, struggles, next, storage_path, content_hash, recorded_at)
       values (gen_random_uuid(), $1::uuid, $2::uuid, 1, 'Borrowing clicked', $3::uuid,
         'Moves are not copies', 'Rewrote the parser', 'Ownership is about drop order',
         'Lifetimes in signatures', 'Try a self-referential struct',
         'learning-records/0001-borrowing.md', 'sha', now())`,
      alice.id,
      missionId,
      lessonId,
    );
  });

  it("signs one grant for the whole reference list", async () => {
    const response = await get(`/v1/missions/${missionId}/reference-docs`, alice);
    expect(response.statusCode).toBe(200);

    const body = response.json<{ docs: ReferenceDocResponse[]; expiresAt: string | null }>();
    const token = new URL(body.docs[0]!.url!).pathname.split("/")[2]!;
    const grant = await verifyViewToken(token, SECRET, Math.floor(Date.now() / 1000));

    expect(grant?.prefix).toBe(`workspaces/${alice.id}/${WORKSPACE_KEY}`);
    expect(new URL(body.docs[0]!.url!).pathname).toContain("/reference/ownership.html");
    expect(body.expiresAt).not.toBeNull();
  });

  it("returns a record with the lesson it came out of, so the reader can link it", async () => {
    const response = await get(
      `/v1/missions/${missionId}/learning-records?lessonId=${lessonId}`,
      alice,
    );
    expect(response.statusCode).toBe(200);

    const [record] = response.json<{ records: LearningRecordResponse[] }>().records;
    expect(record).toMatchObject({
      title: "Borrowing clicked",
      lessonId,
      lessonTitle: "Borrow checker errors",
      struggles: "Lifetimes in signatures",
      next: "Try a self-referential struct",
    });
  });

  it("filters to the lesson asked for and nothing else", async () => {
    const response = await get(
      `/v1/missions/${missionId}/learning-records?lessonId=${plannedId}`,
      alice,
    );

    expect(response.json<{ records: unknown[] }>().records).toEqual([]);
  });

  it("404s both collections for a mission that is not yours", async () => {
    expect((await get(`/v1/missions/${missionId}/reference-docs`, bob)).statusCode).toBe(404);
    expect((await get(`/v1/missions/${missionId}/learning-records`, bob)).statusCode).toBe(404);
  });
});

describe("binding a focus session to a lesson (FR-F3)", () => {
  function start(payload: Record<string, unknown>, user: TestUser = alice) {
    return app.inject({
      method: "POST",
      url: "/v1/focus/sessions/start",
      headers: bearer(user),
      payload,
    });
  }

  it("takes the mission from the lesson, so the reader sends one id", async () => {
    const response = await start({ lessonId });
    expect(response.statusCode).toBe(201);

    expect(response.json<{ lessonId: string; missionId: string }>()).toMatchObject({
      lessonId,
      missionId,
    });
  });

  it("refuses a lesson that is not yours rather than dropping the binding", async () => {
    // RLS cannot catch this: the session being written is Bob's own, and only the
    // lesson id is Alice's. Dropped silently, his time would be recorded against
    // nothing and the lesson would show zero minutes in M6.
    const response = await start({ lessonId }, bob);

    expect(response.statusCode).toBe(422);
    expect(response.json<{ errors: { field: string }[] }>().errors[0]!.field).toBe("lessonId");
  });
});
