import {
  ExerciseViewSchema,
  LessonExercisesViewSchema,
  type ExerciseDeclaration,
} from "@mindforge/core";
import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * Exercises, over HTTP (FR-X2, FR-X5).
 *
 * Parsed through the wire schemas rather than cast, so a field the handler stops
 * returning fails here — the same contract the SPA parses against.
 *
 * Three things are worth the real stack: that the summary is derived correctly
 * from real rows (the grouped query is the one piece of logic that lives in SQL),
 * that `passed` is the server's call and not the client's, and isolation — Bob
 * asking for Alice's lesson, and Bob recording onto it.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;
let lessonId: string;
let plannedId: string;

const EXERCISE: ExerciseDeclaration = {
  key: "retry-backoff",
  kind: "code",
  language: "javascript",
  title: "Retry with backoff",
  prompt: "Write retry().",
  starter: "export function retry() {}\n",
  tests: 'import { retry } from "./solution";\ntest("retries", () => expect(1).toBe(1));\n',
  solution: "export function retry() { return 1; }\n",
  expectedMinutes: 10,
};

const PASS = { name: "retries", passed: true, message: null };
const FAIL = { name: "backs off", passed: false, message: "expected 100 to be 200" };

function list(user: TestUser = alice, id = lessonId) {
  return app.inject({ method: "GET", url: `/v1/lessons/${id}/exercises`, headers: bearer(user) });
}

function attempt(
  body: Record<string, unknown>,
  {
    user = alice,
    id = lessonId,
    key = EXERCISE.key,
  }: { user?: TestUser; id?: string; key?: string } = {},
) {
  return app.inject({
    method: "POST",
    url: `/v1/lessons/${id}/exercises/${key}/attempts`,
    headers: bearer(user),
    payload: { code: "// mine", status: "completed", results: [PASS], ...body },
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
     values (gen_random_uuid(), $1::uuid, 'Resilience', 'active', 'resilience', now(), now())
     returning id`,
    alice.id,
  );

  const [written] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into lessons (id, user_id, mission_id, status, seq, slug, title, storage_path,
       content_hash, exercises, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, 'generated', 1, 'retries', 'Retries',
       'lessons/0001-retries.html', 'sha', $3::jsonb, now(), now())
     returning id`,
    alice.id,
    mission!.id,
    // A second entry the contract refuses: the use case must drop it rather than
    // hand the SPA an exercise with no tests to run.
    JSON.stringify([EXERCISE, { key: "broken", kind: "code" }]),
  );
  lessonId = written!.id;

  const [planned] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into lessons (id, user_id, mission_id, status, slug, title, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, 'planned', 'jitter', 'Jitter', now(), now())
     returning id`,
    alice.id,
    mission!.id,
  );
  plannedId = planned!.id;
});

describe("GET /v1/lessons/:id/exercises", () => {
  it("lists the declared exercises, untried, with the runner's URL", async () => {
    const response = await list();

    expect(response.statusCode).toBe(200);
    const view = LessonExercisesViewSchema.parse(response.json());
    expect(view.runnerUrl).toMatch(/\/runner$/u);
    expect(view.exercises.map((e) => e.key)).toEqual(["retry-backoff"]);
    // Not tried is a state, not a zero score: every field says "nothing yet".
    expect(view.exercises[0]!.attempts).toEqual({
      count: 0,
      firstPassedAt: null,
      lastCode: null,
      lastPassed: null,
      lastAt: null,
      lastResults: null,
      lastScene: null,
    });
  });

  it("has none for a planned lesson, which has no file to declare any", async () => {
    const view = LessonExercisesViewSchema.parse((await list(alice, plannedId)).json());

    expect(view.exercises).toEqual([]);
  });

  it("answers 404 for another user's lesson", async () => {
    expect((await list(bob)).statusCode).toBe(404);
  });
});

describe("POST /v1/lessons/:id/exercises/:key/attempts", () => {
  it("records every run, and summarises them from the rows", async () => {
    await attempt({ code: "// one", status: "error", results: [] });
    await attempt({ code: "// two", results: [PASS, FAIL] });
    const third = await attempt({ code: "// three", results: [PASS] });

    expect(third.statusCode).toBe(201);
    const view = ExerciseViewSchema.parse(third.json());
    expect(view.attempts.count).toBe(3);
    expect(view.attempts.lastCode).toBe("// three");
    expect(view.attempts.lastPassed).toBe(true);
    expect(view.attempts.firstPassedAt).not.toBeNull();
  });

  it("decides `passed` itself, from the results", async () => {
    // A client that says "completed" with a failing result has not passed, and
    // there is no `passed` field in the request to say otherwise.
    const view = ExerciseViewSchema.parse(
      (await attempt({ results: [PASS, FAIL], passed: true })).json(),
    );

    expect(view.attempts.lastPassed).toBe(false);
    expect(view.attempts.firstPassedAt).toBeNull();
  });

  it("keeps the first pass when a later attempt fails", async () => {
    const first = ExerciseViewSchema.parse((await attempt({})).json()).attempts.firstPassedAt;
    const later = ExerciseViewSchema.parse((await attempt({ results: [FAIL] })).json()).attempts;

    expect(later.firstPassedAt).toBe(first);
    expect(later.lastPassed).toBe(false);
  });

  it("stores what the browser reported, including when the learner started", async () => {
    await attempt({ startedAt: "2026-09-24T10:00:00.000Z", results: [PASS, FAIL] });
    const [row] = await db.$queryRawUnsafe<
      { tests_passed: number; tests_total: number; started_at: Date; results: unknown }[]
    >(
      `select tests_passed, tests_total, started_at, results from exercise_attempts
        where lesson_id = $1::uuid`,
      lessonId,
    );

    expect(row!.tests_passed).toBe(1);
    expect(row!.tests_total).toBe(2);
    expect(row!.started_at.toISOString()).toBe("2026-09-24T10:00:00.000Z");
    expect(row!.results).toEqual([PASS, FAIL]);
  });

  it("answers 404 for a key the lesson does not declare", async () => {
    expect((await attempt({}, { key: "jitter" })).statusCode).toBe(404);
  });

  it("answers 422 for a key the URL should never carry", async () => {
    expect((await attempt({}, { key: "Not_A_Key" })).statusCode).toBe(422);
  });

  it("answers 409 on a planned lesson", async () => {
    expect((await attempt({}, { id: plannedId })).statusCode).toBe(409);
  });

  it("refuses a status the runner does not produce", async () => {
    expect((await attempt({ status: "skipped" })).statusCode).toBe(422);
  });

  it("will not let Bob record onto Alice's lesson", async () => {
    expect((await attempt({}, { user: bob })).statusCode).toBe(404);

    const [row] = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from exercise_attempts where lesson_id = $1::uuid`,
      lessonId,
    );
    expect(Number(row!.count)).toBe(0);
  });
});

describe("POST /v1/lessons/:id/exercises/:key/solution-reveals", () => {
  // Review finding: opening the reference solution was recorded nowhere, so a
  // learner could paste it, pass first try, and the lesson read "too easy" — while
  // a rung-5 hint, which shows less, counted as heavy help.
  const reveal = () =>
    app.inject({
      method: "POST",
      url: `/v1/lessons/${lessonId}/exercises/${EXERCISE.key}/solution-reveals`,
      headers: bearer(alice),
    });

  it("records opening the solution as the top rung of help", async () => {
    const response = await reveal();

    expect(response.statusCode).toBe(201);
    const view = ExerciseViewSchema.parse(response.json());
    expect(view.hints).toMatchObject([{ kind: "solution", level: 5, rung: "code" }]);
  });

  it("records it once, however many times the learner opens it", async () => {
    await reveal();
    const view = ExerciseViewSchema.parse((await reveal()).json());

    expect(view.hints.filter((hint) => hint.kind === "solution")).toHaveLength(1);
  });

  it("makes a pass after it heavy help, not a first-try pass", async () => {
    await reveal();
    await attempt({ results: [PASS] });
    await db.$executeRawUnsafe(
      `update lessons set completed_at = now(), outcome = 'understood' where id = $1::uuid`,
      lessonId,
    );

    const listed = LessonExercisesViewSchema.parse((await list()).json());
    expect(listed.strain).toEqual({ verdict: "too-hard", reasons: ["heavy-hints"] });
  });
});
