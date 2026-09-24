import { LessonExercisesViewSchema, type ExerciseDeclaration } from "@mindforge/core";
import type { PrismaClient } from "@mindforge/db";
import type { ReviewCall } from "@mindforge/llm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { REVIEWER, type Reviewer } from "../src/modules/exercises/domain/reviewer.port.js";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * Whiteboard reviews, over HTTP (FR-X7–X9).
 *
 * The reviewer is stubbed (`test/setup.ts` removes the key, so an unstubbed call
 * refuses rather than bills). What the stack proves: a request carrying a real-size
 * PNG gets through the body limit, the rubric is withheld until a review exists,
 * the review lands as an attempt that says it was graded by review, and it feeds
 * the same verdict a code attempt does.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let lessonId: string;
let reviewer: Reviewer;

const BOARD: ExerciseDeclaration = {
  key: "url-shortener",
  kind: "whiteboard",
  title: "Design a URL shortener",
  prompt: "Draw the read and write paths.",
  rubric: ["Separates reads from writes", "Caches hot redirects"],
  solution: "Two paths; a cache on reads.",
  expectedMinutes: 20,
};

const reviewed = (verdicts: ("covered" | "partly" | "missing")[]): ReviewCall => ({
  answer: {
    kind: "review",
    items: verdicts.map((verdict, i) => ({ item: BOARD.rubric[i]!, verdict, note: `note ${i}` })),
    overall: "One sentence.",
  },
  model: "claude-opus-5",
  usage: { inputTokens: 3_000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 },
  requestId: "req_rev",
});

const exercises = async () =>
  LessonExercisesViewSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: `/v1/lessons/${lessonId}/exercises`,
        headers: bearer(alice),
      })
    ).json(),
  ).exercises[0]!;

const submit = (image = "data:image/png;base64,AAAA") =>
  app.inject({
    method: "POST",
    url: `/v1/lessons/${lessonId}/exercises/${BOARD.key}/reviews`,
    headers: bearer(alice),
    payload: {
      elements: [
        { id: "a", type: "rectangle" },
        { id: "t", type: "text", containerId: "a", text: "API" },
      ],
      image,
      startedAt: null,
    },
  });

beforeAll(async () => {
  app = await bootApp();
  db = adminDb();
  alice = await signUp();
  reviewer = app.get<Reviewer>(REVIEWER, { strict: false });
});

afterAll(async () => {
  await deleteUsers(db, [alice.id]);
  await app.close();
  await db.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.$executeRawUnsafe(`delete from missions where user_id = $1::uuid`, alice.id);
  await db.$executeRawUnsafe(`delete from llm_calls where user_id = $1::uuid`, alice.id);

  const [mission] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'Design', 'active', 'design', now(), now()) returning id`,
    alice.id,
  );
  const [lesson] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into lessons (id, user_id, mission_id, status, seq, slug, title, storage_path,
       content_hash, exercises, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, 'generated', 1, 'shortener', 'Shortener',
       'lessons/0001-shortener.html', 'sha', $3::jsonb, now(), now())
     returning id`,
    alice.id,
    mission!.id,
    JSON.stringify([BOARD]),
  );
  lessonId = lesson!.id;
});

describe("POST /v1/lessons/:id/exercises/:key/reviews", () => {
  it("withholds the rubric until a review, then shows it with the verdicts", async () => {
    const before = await exercises();
    expect(before).toMatchObject({ kind: "whiteboard", rubric: null, solution: null });

    vi.spyOn(reviewer, "review").mockResolvedValue(reviewed(["covered", "partly"]));
    const response = await submit();
    expect(response.statusCode).toBe(201);

    const after = await exercises();
    expect(after).toMatchObject({ rubric: BOARD.rubric, solution: "Two paths; a cache on reads." });
    expect(after.attempts.lastResults).toEqual([
      { name: BOARD.rubric[0], passed: true, message: "note 0", verdict: "covered" },
      { name: BOARD.rubric[1], passed: false, message: "note 1", verdict: "partly" },
    ]);
    // The canvas resumes from what was reviewed.
    expect(after.attempts.lastScene?.map((e) => e.id)).toEqual(["a", "t"]);
  });

  it("stores the attempt as graded by review, with its drawing and its bill", async () => {
    vi.spyOn(reviewer, "review").mockResolvedValue(reviewed(["covered", "covered"]));

    await submit();

    const [row] = await db.$queryRawUnsafe<
      { graded_by: string; passed: boolean; code: string; feedback: string; billed: boolean }[]
    >(
      `select a.graded_by, a.passed, a.code, a.feedback,
              exists (select 1 from llm_calls c where c.id = a.llm_call_id
                        and c.purpose = 'exercise_review') as billed
         from exercise_attempts a where a.lesson_id = $1::uuid`,
      lessonId,
    );
    expect(row).toMatchObject({
      graded_by: "review",
      passed: true,
      feedback: "One sentence.",
      billed: true,
    });
    // What the reviewer read, kept beside what it said.
    expect(row!.code).toContain("- rectangle: API");
  });

  it("takes a canvas image of a few megabytes, past Fastify's default limit", async () => {
    vi.spyOn(reviewer, "review").mockResolvedValue(reviewed(["covered", "covered"]));

    const response = await submit(`data:image/png;base64,${"A".repeat(3_000_000)}`);

    expect(response.statusCode).toBe(201);
  });

  it("refuses an image past the schema's cap, rather than sending it to the model", async () => {
    const review = vi.spyOn(reviewer, "review");

    expect((await submit("A".repeat(4_000_001))).statusCode).toBe(422);
    expect(review).not.toHaveBeenCalled();
  });

  it("refuses a drawing too large to store before asking for a review", async () => {
    // Review finding: a drawing could pass validation, be reviewed and billed, then
    // fail the database's size check — which rolled the bill back with the attempt.
    const review = vi.spyOn(reviewer, "review");
    const freehand = Array.from({ length: 200 }, (_, i) => ({
      id: `f${i}`,
      type: "freedraw",
      points: Array.from({ length: 1_000 }, (_, j) => [j, j * 2]),
    }));

    const response = await app.inject({
      method: "POST",
      url: `/v1/lessons/${lessonId}/exercises/${BOARD.key}/reviews`,
      headers: bearer(alice),
      payload: { elements: freehand, image: "AAAA", startedAt: null },
    });

    expect(response.statusCode).toBe(422);
    expect(review).not.toHaveBeenCalled();
  });

  it("answers 503 with nothing billed when no key is configured", async () => {
    // Unstubbed: `test/setup.ts` removed the key, so this is the real adapter refusing.
    const response = await submit();

    expect(response.statusCode).toBe(503);
    expect(response.json<{ type: string }>().type).toMatch(/reviews-unavailable$/u);
  });

  it("feeds the lesson's verdict like any attempt: finished and all covered is in the zone", async () => {
    vi.spyOn(reviewer, "review").mockResolvedValue(reviewed(["covered", "covered"]));
    await submit();
    await db.$executeRawUnsafe(
      `update lessons set completed_at = now(), outcome = 'understood' where id = $1::uuid`,
      lessonId,
    );

    const view = LessonExercisesViewSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/lessons/${lessonId}/exercises`,
          headers: bearer(alice),
        })
      ).json(),
    );
    // No recorded start, so not "too easy" — timing unknown is never a push.
    expect(view.strain).toEqual({ verdict: "in-zone", reasons: ["passed"] });
  });
});
