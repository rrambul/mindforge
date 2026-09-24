import { LessonExercisesViewSchema, type ExerciseDeclaration } from "@mindforge/core";
import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * `task` exercises over HTTP: code run on the learner's machine, reported back.
 *
 * Nothing is called and nothing is billed, so there is nothing to stub. What the
 * stack proves is the honesty of the record: a report is stored as the learner's
 * word (`graded_by = 'self'`), and it feeds the lesson's verdict like any attempt —
 * except that, with no clock behind it, it can never make a lesson "too easy".
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;
let lessonId: string;

const TASK: ExerciseDeclaration = {
  key: "gen-counter",
  kind: "task",
  title: "A counter as a GenServer",
  prompt: "Write Counter with increment/1 and value/1.",
  language: "elixir",
  files: [
    { path: "lib/counter.ex", contents: "defmodule Counter do\nend\n" },
    {
      path: "test/counter_test.exs",
      contents: "defmodule CounterTest do\n  use ExUnit.Case\nend\n",
    },
  ],
  command: "mix test",
  solution: null,
  expectedMinutes: 15,
};

const view = async () =>
  LessonExercisesViewSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: `/v1/lessons/${lessonId}/exercises`,
        headers: bearer(alice),
      })
    ).json(),
  );

const reportAs = (payload: Record<string, unknown>, user: TestUser = alice) =>
  app.inject({
    method: "POST",
    url: `/v1/lessons/${lessonId}/exercises/${TASK.key}/reports`,
    headers: bearer(user),
    payload,
  });

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
     values (gen_random_uuid(), $1::uuid, 'Elixir', 'active', 'elixir', now(), now()) returning id`,
    alice.id,
  );
  const [lesson] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into lessons (id, user_id, mission_id, status, seq, slug, title, storage_path,
       content_hash, exercises, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, 'generated', 1, 'genserver', 'GenServer',
       'lessons/0001-genserver.html', 'sha', $3::jsonb, now(), now())
     returning id`,
    alice.id,
    mission!.id,
    JSON.stringify([TASK]),
  );
  lessonId = lesson!.id;
});

describe("POST /v1/lessons/:id/exercises/:key/reports", () => {
  it("lists the task with its files and command, and records a report as the learner's word", async () => {
    const listed = (await view()).exercises[0]!;
    expect(listed).toMatchObject({ kind: "task", command: "mix test", language: "elixir" });

    const response = await reportAs({ passed: false, output: "  1 test, 1 failure  " });
    expect(response.statusCode).toBe(201);

    const [row] = await db.$queryRawUnsafe<{ graded_by: string; code: string; passed: boolean }[]>(
      `select graded_by, code, passed from exercise_attempts where lesson_id = $1::uuid`,
      lessonId,
    );
    // Who decided is recorded, not implied: nothing the app ran says this.
    expect(row).toEqual({ graded_by: "self", code: "1 test, 1 failure", passed: false });

    const after = (await view()).exercises[0]!;
    expect(after.attempts.lastResults).toEqual([
      { name: "mix test", passed: false, message: null },
    ]);
  });

  it("judges a finished task lesson from the reports: a failure is too hard", async () => {
    await reportAs({ passed: false, output: null });
    await db.$executeRawUnsafe(
      `update lessons set completed_at = now(), outcome = 'shaky' where id = $1::uuid`,
      lessonId,
    );

    expect((await view()).strain).toEqual({ verdict: "too-hard", reasons: ["never-passed"] });
  });

  it("never calls a task lesson too easy — the work happened out of the app's sight, unclocked", async () => {
    await reportAs({ passed: true, output: null });
    await db.$executeRawUnsafe(
      `update lessons set completed_at = now(), outcome = 'understood' where id = $1::uuid`,
      lessonId,
    );

    expect((await view()).strain).toEqual({ verdict: "in-zone", reasons: ["passed"] });
  });

  it("refuses output past its cap, another user, and the other kinds' endpoints", async () => {
    expect((await reportAs({ passed: true, output: "x".repeat(20_001) })).statusCode).toBe(422);
    expect((await reportAs({ passed: true, output: null }, bob)).statusCode).toBe(404);

    const attempt = await app.inject({
      method: "POST",
      url: `/v1/lessons/${lessonId}/exercises/${TASK.key}/attempts`,
      headers: bearer(alice),
      payload: {
        code: "x",
        status: "completed",
        results: [{ name: "a", passed: true, message: null }],
      },
    });
    // A browser cannot post a tested pass for code it never ran.
    expect(attempt.statusCode).toBe(409);
  });
});
