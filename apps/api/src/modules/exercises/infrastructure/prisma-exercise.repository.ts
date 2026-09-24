import { Inject, Injectable } from "@nestjs/common";

import {
  SceneElementSchema,
  TestResultSchema,
  type SceneElement,
  type Strain,
  type TestResult,
} from "@mindforge/core";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type {
  AttemptSummary,
  ExerciseRepository,
  ExerciseSnapshot,
  HintRecord,
  NewAttempt,
  NewHint,
  NewReport,
  NewReview,
  NewSolutionReveal,
} from "../domain/exercise.repository.js";
import { judgeLessons } from "./judge-lessons.js";

/** The `llm_calls.purpose` a hint is billed under. */
export const HINT_PURPOSE = "exercise_hint";
/** The purpose a whiteboard review is billed under. */
export const REVIEW_PURPOSE = "exercise_review";

interface HintRow {
  readonly exercise_key: string;
  readonly kind: string;
  readonly level: number;
  readonly question: string | null;
  readonly answer: string;
  readonly created_at: Date;
}

interface SummaryRow {
  readonly exercise_key: string;
  readonly count: bigint;
  readonly first_passed_at: Date | null;
  readonly last_code: string | null;
  readonly last_passed: boolean | null;
  readonly last_at: Date | null;
  readonly last_results: unknown;
  readonly last_scene: unknown;
}

/**
 * Exercises through RLS, like every user read (§3.6).
 *
 * The summary is derived on read (principle 2): the count, the first pass and the
 * latest attempt, in one grouped query, never a counter kept in step by hand.
 */
@Injectable()
export class PrismaExerciseRepository implements ExerciseRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  declaredOn(userId: string, lessonId: string): Promise<unknown[] | null> {
    return this.db.run(userId, async (tx) => (await readLesson(tx, lessonId))?.exercises ?? null);
  }

  summaries(userId: string, lessonId: string): Promise<ReadonlyMap<string, AttemptSummary>> {
    return this.db.run(userId, (tx) => readSummaries(tx, lessonId));
  }

  hints(userId: string, lessonId: string): Promise<ReadonlyMap<string, readonly HintRecord[]>> {
    return this.db.run(userId, (tx) => readHints(tx, lessonId));
  }

  strainOf(userId: string, lessonId: string): Promise<Strain> {
    return this.db.run(userId, async (tx) =>
      strainFrom(tx, lessonId, await readLesson(tx, lessonId)),
    );
  }

  /**
   * Everything the exercise list needs, in one transaction (review finding: it was
   * four, one per method, and `strainOf` re-read the lesson the first had just
   * read). One snapshot is also one consistent read: the summary and the verdict
   * can no longer be taken either side of an attempt landing.
   */
  snapshot(userId: string, lessonId: string): Promise<ExerciseSnapshot | null> {
    return this.db.run(userId, async (tx) => {
      const lesson = await readLesson(tx, lessonId);
      if (lesson === null) return null;
      return {
        declared: lesson.exercises,
        summaries: await readSummaries(tx, lessonId),
        hints: await readHints(tx, lessonId),
        strain: await strainFrom(tx, lessonId, lesson),
      };
    });
  }

  async recordSolutionReveal(userId: string, reveal: NewSolutionReveal): Promise<void> {
    await this.db.run(userId, (tx) =>
      // Once per exercise: the first opening is the fact that matters, and a
      // learner who reopens it to compare has not been helped a second time.
      tx.$executeRawUnsafe(
        `insert into exercise_hints
           (user_id, lesson_id, exercise_key, kind, level, question, answer, created_at)
         select $1::uuid, $2::uuid, $3, 'solution', 5, null, $4, $5::timestamptz
          where not exists (
            select 1 from exercise_hints
             where lesson_id = $2::uuid and exercise_key = $3 and kind = 'solution')`,
        userId,
        reveal.lessonId,
        reveal.exerciseKey,
        reveal.shown,
        reveal.createdAt,
      ),
    );
  }

  async record(userId: string, attempt: NewAttempt): Promise<void> {
    const testsPassed = attempt.results.filter((result) => result.passed).length;

    await this.db.run(userId, (tx) =>
      tx.$executeRawUnsafe(
        `insert into exercise_attempts
           (user_id, lesson_id, exercise_key, code, status, results, tests_passed, tests_total,
            passed, started_at, created_at)
         values ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::int, $8::int, $9::boolean,
                 $10::timestamptz, $11::timestamptz)`,
        userId,
        attempt.lessonId,
        attempt.exerciseKey,
        attempt.code,
        attempt.status,
        JSON.stringify(attempt.results),
        testsPassed,
        attempt.results.length,
        attempt.passed,
        attempt.startedAt,
        attempt.createdAt,
      ),
    );
  }

  async recordHint(userId: string, hint: NewHint): Promise<void> {
    const { call } = hint;

    await this.db.run(userId, async (tx) => {
      const callId = await insertCall(tx, userId, HINT_PURPOSE, call);

      if (hint.answer === null) return;

      await tx.$executeRawUnsafe(
        `insert into exercise_hints
           (user_id, lesson_id, exercise_key, level, question, answer, llm_call_id, created_at)
         values ($1::uuid, $2::uuid, $3, $4::smallint, $5, $6, $7::uuid, $8::timestamptz)`,
        userId,
        hint.lessonId,
        hint.exerciseKey,
        hint.level,
        hint.question,
        hint.answer,
        callId,
        call.createdAt,
      );
    });
  }

  async recordReport(userId: string, report: NewReport): Promise<void> {
    await this.db.run(userId, (tx) =>
      tx.$executeRawUnsafe(
        `insert into exercise_attempts
           (user_id, lesson_id, exercise_key, code, status, results, tests_passed, tests_total,
            passed, created_at, graded_by)
         values ($1::uuid, $2::uuid, $3, $4, 'completed', $5::jsonb, $6::int, 1, $7::boolean,
                 $8::timestamptz, 'self')`,
        userId,
        report.lessonId,
        report.exerciseKey,
        report.output,
        JSON.stringify([report.result]),
        report.result.passed ? 1 : 0,
        report.result.passed,
        report.createdAt,
      ),
    );
  }

  async recordReview(userId: string, review: NewReview): Promise<void> {
    await this.db.run(userId, async (tx) => {
      const callId = await insertCall(tx, userId, REVIEW_PURPOSE, review.call);
      if (review.review === null) return;

      const { results, passed, feedback } = review.review;
      await tx.$executeRawUnsafe(
        `insert into exercise_attempts
           (user_id, lesson_id, exercise_key, code, status, results, tests_passed, tests_total,
            passed, started_at, created_at, graded_by, scene, feedback, llm_call_id)
         values ($1::uuid, $2::uuid, $3, $4, 'completed', $5::jsonb, $6::int, $7::int, $8::boolean,
                 $9::timestamptz, $10::timestamptz, 'review', $11::jsonb, $12, $13::uuid)`,
        userId,
        review.lessonId,
        review.exerciseKey,
        review.description,
        JSON.stringify(results),
        results.filter((result) => result.passed).length,
        results.length,
        passed,
        review.startedAt,
        review.call.createdAt,
        JSON.stringify(review.scene),
        feedback,
        callId,
      );
    });
  }
}

type Tx = Parameters<Parameters<UserScopedDb["run"]>[1]>[0];

interface LessonRow {
  readonly id: string;
  readonly outcome: string | null;
  readonly exercises: unknown[];
}

async function readLesson(tx: Tx, lessonId: string): Promise<LessonRow | null> {
  const [row] = await tx.$queryRawUnsafe<
    { id: string; outcome: string | null; exercises: unknown }[]
  >(`select id, outcome, exercises from lessons where id = $1::uuid`, lessonId);
  if (row === undefined) return null;
  // CHECKed to be an array; narrowed anyway rather than cast.
  return { ...row, exercises: Array.isArray(row.exercises) ? (row.exercises as unknown[]) : [] };
}

async function readSummaries(
  tx: Tx,
  lessonId: string,
): Promise<ReadonlyMap<string, AttemptSummary>> {
  const rows = await tx.$queryRawUnsafe<SummaryRow[]>(
    `select exercise_key,
            count(*) as count,
            min(created_at) filter (where passed) as first_passed_at,
            (array_agg(code order by created_at desc, id desc))[1] as last_code,
            (array_agg(passed order by created_at desc, id desc))[1] as last_passed,
            (array_agg(results order by created_at desc, id desc))[1] as last_results,
            (array_agg(scene order by created_at desc, id desc))[1] as last_scene,
            max(created_at) as last_at
       from exercise_attempts
      where lesson_id = $1::uuid
      group by exercise_key`,
    lessonId,
  );

  return new Map(
    rows.map((row) => [
      row.exercise_key,
      {
        count: Number(row.count),
        firstPassedAt: row.first_passed_at,
        lastCode: row.last_code,
        lastPassed: row.last_passed,
        lastAt: row.last_at,
        lastResults: resultsOf(row.last_results),
        lastScene: sceneOf(row.last_scene),
      },
    ]),
  );
}

async function readHints(
  tx: Tx,
  lessonId: string,
): Promise<ReadonlyMap<string, readonly HintRecord[]>> {
  const rows = await tx.$queryRawUnsafe<HintRow[]>(
    `select exercise_key, kind, level, question, answer, created_at
       from exercise_hints
      where lesson_id = $1::uuid
      order by created_at, id`,
    lessonId,
  );

  const byKey = new Map<string, HintRecord[]>();
  for (const row of rows) {
    const list = byKey.get(row.exercise_key) ?? [];
    list.push({
      kind: row.kind === "solution" ? "solution" : "hint",
      level: row.level,
      question: row.question,
      answer: row.answer,
      createdAt: row.created_at,
    });
    byKey.set(row.exercise_key, list);
  }
  return byKey;
}

async function strainFrom(tx: Tx, lessonId: string, lesson: LessonRow | null): Promise<Strain> {
  // An unreadable lesson has nothing to judge; the caller has already 404ed it.
  if (lesson === null) return { verdict: null, unknown: "no-exercise" };
  return (
    (await judgeLessons(tx, [lesson])).get(lessonId) ?? { verdict: null, unknown: "no-exercise" }
  );
}

/** One `llm_calls` row, returning its id. Shared by hints and reviews. */
async function insertCall(
  tx: Tx,
  userId: string,
  purpose: string,
  call: NewReview["call"],
): Promise<string> {
  const [written] = await tx.$queryRawUnsafe<{ id: string }[]>(
    // `id` explicitly: `llm_calls.id` has no database default — Prisma's
    // `@default(uuid())` is generated client-side, so a raw insert must supply it.
    `insert into llm_calls
       (id, user_id, purpose, model, call_key, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, cost_usd, latency_ms, created_at)
     values (gen_random_uuid(), $1::uuid, $2, $3, $4, $5::int, $6::int, $7::int, $8::int,
             $9::numeric, $10::int, $11::timestamptz)
     returning id`,
    userId,
    purpose,
    call.model,
    call.requestId,
    call.inputTokens,
    call.outputTokens,
    call.cacheReadTokens,
    call.cacheWriteTokens,
    // As a string, so the numeric column is written without a float in between.
    call.costUsd === null ? null : call.costUsd.toFixed(6),
    call.latencyMs,
    call.createdAt,
  );
  return written!.id;
}

/** The stored results, re-validated: jsonb written by this app, but read as untrusted like every column. */
function resultsOf(value: unknown): readonly TestResult[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = TestResultSchema.array().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function sceneOf(value: unknown): readonly SceneElement[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = SceneElementSchema.array().safeParse(value);
  return parsed.success ? parsed.data : null;
}
