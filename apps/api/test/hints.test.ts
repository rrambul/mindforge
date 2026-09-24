import { ExerciseViewSchema, type ExerciseDeclaration } from "@mindforge/core";
import type { PrismaClient } from "@mindforge/db";
import type { HintCall } from "@mindforge/llm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HINT_GENERATOR,
  type HintGenerator,
} from "../src/modules/exercises/domain/hint-generator.port.js";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * Hints, over HTTP (FR-H1–H4).
 *
 * The model is stubbed — `test/setup.ts` removes the API key, so an unstubbed call
 * would refuse rather than bill — and everything else is real: the ladder is
 * enforced against rows in `exercise_hints`, the cost lands in `llm_calls` where the
 * spend meter reads it, and the daily budget refusal is the same one lesson runs meet.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;
let lessonId: string;
let generator: HintGenerator;

const EXERCISE: ExerciseDeclaration = {
  key: "commit-index",
  kind: "code",
  language: "typescript",
  title: "Which entries are committed?",
  prompt: "Return the highest index on a majority.",
  starter: "export function committedIndex() { return 0; }\n",
  tests: 'test("x", () => expect(1).toBe(1));\n',
  solution: null,
  expectedMinutes: 10,
};

function answered(text: string, model = "claude-opus-5"): HintCall {
  return {
    answer: { kind: "hint", text },
    model,
    usage: { inputTokens: 1_200, outputTokens: 90, cacheReadTokens: 800, cacheWriteTokens: 0 },
    requestId: "req_test",
  };
}

function ask(
  level: number,
  { user = alice, question = null }: { user?: TestUser; question?: string | null } = {},
) {
  return app.inject({
    method: "POST",
    url: `/v1/lessons/${lessonId}/exercises/${EXERCISE.key}/hints`,
    headers: bearer(user),
    payload: { level, code: "// stuck", lastRun: null, question },
  });
}

async function llmCalls(): Promise<
  { purpose: string; cost_usd: string | null; agent_run_id: string | null }[]
> {
  return db.$queryRawUnsafe(
    `select purpose, cost_usd::text, agent_run_id from llm_calls where user_id = $1::uuid order by created_at`,
    alice.id,
  );
}

beforeAll(async () => {
  app = await bootApp();
  db = adminDb();
  alice = await signUp();
  bob = await signUp();
  generator = app.get<HintGenerator>(HINT_GENERATOR, { strict: false });
});

afterAll(async () => {
  await deleteUsers(db, [alice.id, bob.id]);
  await app.close();
  await db.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.$executeRawUnsafe(`delete from missions where user_id = $1::uuid`, alice.id);
  await db.$executeRawUnsafe(`delete from llm_calls where user_id = $1::uuid`, alice.id);

  const [mission] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'Raft', 'active', 'raft', now(), now()) returning id`,
    alice.id,
  );
  const [lesson] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into lessons (id, user_id, mission_id, status, seq, slug, title, storage_path,
       content_hash, exercises, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, 'generated', 1, 'commit', 'Commit',
       'lessons/0001-commit.html', 'sha', $3::jsonb, now(), now())
     returning id`,
    alice.id,
    mission!.id,
    JSON.stringify([EXERCISE]),
  );
  lessonId = lesson!.id;
});

describe("POST /v1/lessons/:id/exercises/:key/hints", () => {
  it("gives a hint, keeps it, and bills it where the spend meter reads", async () => {
    vi.spyOn(generator, "generate").mockResolvedValue(answered("Which way is the list sorted?"));

    const response = await ask(1);

    expect(response.statusCode).toBe(201);
    const view = ExerciseViewSchema.parse(response.json());
    expect(view.hints).toMatchObject([
      { level: 1, rung: "question", answer: "Which way is the list sorted?" },
    ]);
    expect(view.nextHintLevel).toBe(2);

    // A hint call has no agent run behind it, and is priced like any other call.
    const [call] = await llmCalls();
    expect(call).toMatchObject({ purpose: "exercise_hint", agent_run_id: null });
    expect(Number(call!.cost_usd)).toBeGreaterThan(0);

    // The same meter lesson runs draw on (FR-T8), so the hint is on it.
    const spend = await app.inject({
      method: "GET",
      url: "/v1/teach/spend",
      headers: bearer(alice),
    });
    expect(spend.statusCode).toBe(200);
    expect(spend.json<{ spentUsd: number }>().spentUsd).toBeGreaterThan(0);
  });

  it("will not skip the ladder, and spends nothing refusing", async () => {
    const generate = vi.spyOn(generator, "generate");

    expect((await ask(3)).statusCode).toBe(409);
    expect(generate).not.toHaveBeenCalled();
    expect(await llmCalls()).toEqual([]);
  });

  it("climbs one rung per hint, and a hint survives a reload", async () => {
    vi.spyOn(generator, "generate")
      .mockResolvedValueOnce(answered("A question."))
      .mockResolvedValueOnce(answered("A clue."));

    await ask(1);
    await ask(2);
    const listed = await app.inject({
      method: "GET",
      url: `/v1/lessons/${lessonId}/exercises`,
      headers: bearer(alice),
    });

    const exercise = listed.json<{
      exercises: { hints: { level: number }[]; nextHintLevel: number }[];
    }>().exercises[0]!;
    expect(exercise.hints.map((h) => h.level)).toEqual([1, 2]);
    expect(exercise.nextHintLevel).toBe(3);
  });

  it("bills a refused call and stores no hint for it", async () => {
    vi.spyOn(generator, "generate").mockResolvedValue({
      ...answered(""),
      answer: { kind: "refused" },
    });

    expect((await ask(1)).statusCode).toBe(503);
    expect(await llmCalls()).toHaveLength(1);
    const [row] = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from exercise_hints where lesson_id = $1::uuid`,
      lessonId,
    );
    expect(Number(row!.count)).toBe(0);
  });

  it("stores an unpriced model's call as unpriced, not free", async () => {
    vi.spyOn(generator, "generate").mockResolvedValue(answered("A question.", "claude-unknown-9"));

    await ask(1);

    expect((await llmCalls())[0]!.cost_usd).toBeNull();
  });

  it("answers 503 when no key is configured, rather than trying another credential", async () => {
    // Unstubbed: setup.ts removed the key, so this is the real adapter refusing.
    expect((await ask(1)).statusCode).toBe(503);
    expect(await llmCalls()).toEqual([]);
  });

  it("will not give Bob a hint on Alice's lesson", async () => {
    const generate = vi.spyOn(generator, "generate");

    expect((await ask(1, { user: bob })).statusCode).toBe(404);
    expect(generate).not.toHaveBeenCalled();
  });

  it("refuses a question that is only whitespace", async () => {
    expect((await ask(1, { question: "   " })).statusCode).toBe(422);
  });
});
