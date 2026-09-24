import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";

/**
 * `exercise_attempts` and `lessons.exercises` (FR-X1, FR-X5): isolation, and the
 * constraints that carry the design.
 *
 * **Isolation** is non-negotiable 2, and this table has one hole the others do
 * not: `user_id = auth.uid()` proves an attempt is yours, not that the lesson it
 * hangs off is. The insert policy checks both, and the test that plants an attempt
 * of Alice's on Bob's lesson is the one that would pass vacuously without it.
 *
 * **Measured, not argued**, the way `curriculum-tracks.test.ts` measures: with the
 * lesson half of the insert policy removed, "refuses an attempt on another user's
 * lesson" fails and nothing else does; with `using (true)` on select, the two read
 * tests fail. Each assertion discriminates on the policy it is about.
 */

const ADMIN_URL =
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Distinct from every other suite's pair — the delete-by-id sweep below is per file.
const ALICE = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
const BOB = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2";

const admin = createPrismaClient(ADMIN_URL);

type TxClient = Omit<
  typeof admin,
  "$transaction" | "$connect" | "$disconnect" | "$on" | "$extends"
>;

function asUser<T>(userId: string, sql: string, ...params: unknown[]): Promise<T> {
  return admin.$transaction<T>(async (tx: TxClient) => {
    await tx.$executeRawUnsafe(`set local role authenticated`);
    await tx.$executeRawUnsafe(
      `select set_config('request.jwt.claims', $1, true)`,
      JSON.stringify({ sub: userId, role: "authenticated" }),
    );
    return await tx.$queryRawUnsafe(sql, ...params);
  });
}

const lessonOf: Record<string, string> = {};

const INSERT = `insert into exercise_attempts
  (user_id, lesson_id, exercise_key, code, status, results, tests_passed, tests_total, passed)
  values ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::int, $8::int, $9::boolean)
  returning id`;

function attempt(
  userId: string,
  lessonId: string,
  over: Partial<{
    key: string;
    code: string;
    status: string;
    results: string;
    testsPassed: number;
    testsTotal: number;
    passed: boolean;
  }> = {},
): unknown[] {
  return [
    userId,
    lessonId,
    over.key ?? "retry-backoff",
    over.code ?? `// ${userId}`,
    over.status ?? "completed",
    over.results ?? "[]",
    over.testsPassed ?? 1,
    over.testsTotal ?? 2,
    over.passed ?? false,
  ];
}

async function seedUser(id: string): Promise<void> {
  await admin.$executeRawUnsafe(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at)
     values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', $2, '', now(), now(), now())
     on conflict (id) do nothing`,
    id,
    `${id}@test.local`,
  );
}

async function seedLesson(userId: string): Promise<string> {
  const [mission] = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2, 'active', $2, now(), now()) returning id`,
    userId,
    `${userId}-mission`,
  );
  const [lesson] = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into lessons (id, user_id, mission_id, seq, slug, title, storage_path, content_hash,
       created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, 1, 'retries', 'Retries',
       'lessons/0001-retries.html', 'sha', now(), now())
     returning id`,
    userId,
    mission!.id,
  );
  return lesson!.id;
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  for (const user of [ALICE, BOB]) {
    await seedUser(user);
    const lesson = await seedLesson(user);
    lessonOf[user] = lesson;
    await admin.$executeRawUnsafe(INSERT, ...attempt(user, lesson));
  }
});

afterAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  await admin.$disconnect();
});

describe("row-level security on exercise_attempts", () => {
  it("shows each user only their own attempts", async () => {
    const rows = await asUser<{ code: string }[]>(ALICE, `select code from exercise_attempts`);

    expect(rows.map((r) => r.code)).toEqual([`// ${ALICE}`]);
  });

  it("returns nothing when reading another user's attempts by user_id", async () => {
    const rows = await asUser<unknown[]>(
      ALICE,
      `select id from exercise_attempts where user_id = $1::uuid`,
      BOB,
    );

    expect(rows).toEqual([]);
  });

  it("lets a learner record an attempt on their own lesson", async () => {
    const rows = await asUser<{ id: string }[]>(ALICE, INSERT, ...attempt(ALICE, lessonOf[ALICE]!));

    expect(rows).toHaveLength(1);
  });

  it("refuses an attempt owned by someone else", async () => {
    await expect(asUser(ALICE, INSERT, ...attempt(BOB, lessonOf[BOB]!))).rejects.toThrow(
      /row-level security/u,
    );
  });

  it("refuses an attempt of your own on another user's lesson", async () => {
    // The case `user_id = auth.uid()` alone lets through: the row is Alice's, but
    // it is a foreign key into Bob's data that Bob cannot see.
    await expect(asUser(ALICE, INSERT, ...attempt(ALICE, lessonOf[BOB]!))).rejects.toThrow(
      /row-level security/u,
    );
  });

  it("does not let an attempt be rewritten, even by its owner", async () => {
    // Append-only: "how many tries did it take" is Phase 3's signal, and an
    // update would let a bad afternoon be edited into a good one.
    const updated = await asUser<{ id: string }[]>(
      ALICE,
      `update exercise_attempts set passed = true, tests_passed = 2 where user_id = $1::uuid returning id`,
      ALICE,
    );

    expect(updated).toEqual([]);
  });

  it("refuses to delete another user's attempts", async () => {
    await asUser(ALICE, `delete from exercise_attempts where user_id = $1::uuid`, BOB);
    const [row] = await admin.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from exercise_attempts where user_id = $1::uuid`,
      BOB,
    );

    expect(Number(row!.count)).toBe(1);
  });
});

describe("the constraints on exercise_attempts", () => {
  const insertAsAdmin = (over: Parameters<typeof attempt>[2]) =>
    admin.$executeRawUnsafe(INSERT, ...attempt(ALICE, lessonOf[ALICE]!, over));

  it("refuses a pass with a failing test in it", async () => {
    await expect(insertAsAdmin({ passed: true, testsPassed: 1, testsTotal: 2 })).rejects.toThrow(
      /exercise_attempts_passed_means_all/u,
    );
  });

  it("refuses a pass with no tests at all — an empty suite proves nothing", async () => {
    await expect(insertAsAdmin({ passed: true, testsPassed: 0, testsTotal: 0 })).rejects.toThrow(
      /exercise_attempts_passed_means_all/u,
    );
  });

  it("refuses a pass from a run that did not complete", async () => {
    await expect(
      insertAsAdmin({ passed: true, status: "timeout", testsPassed: 2, testsTotal: 2 }),
    ).rejects.toThrow(/exercise_attempts_passed_means_all/u);
  });

  it("accepts a real pass", async () => {
    await expect(insertAsAdmin({ passed: true, testsPassed: 2, testsTotal: 2 })).resolves.toBe(1);
  });

  it("refuses a key the URL could not carry", async () => {
    await expect(insertAsAdmin({ key: "../up" })).rejects.toThrow(/exercise_attempts_key_shape/u);
  });

  it("refuses a status the product does not know", async () => {
    await expect(insertAsAdmin({ status: "skipped" })).rejects.toThrow(/exercise_attempts_status/u);
  });

  it("goes with its lesson", async () => {
    const lesson = await seedLessonForCascade();
    await admin.$executeRawUnsafe(INSERT, ...attempt(ALICE, lesson));
    await admin.$executeRawUnsafe(`delete from lessons where id = $1::uuid`, lesson);

    const [row] = await admin.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from exercise_attempts where lesson_id = $1::uuid`,
      lesson,
    );
    expect(Number(row!.count)).toBe(0);
  });
});

describe("whiteboard reviews on exercise_attempts", () => {
  const review = (graded: string, scene: string | null, feedback: string | null = null) =>
    admin.$executeRawUnsafe(
      `insert into exercise_attempts
         (user_id, lesson_id, exercise_key, code, status, results, tests_passed, tests_total,
          passed, graded_by, scene, feedback)
       values ($1::uuid, $2::uuid, 'url-shortener', 'Shapes: none.', 'completed', '[]', 0, 2,
               false, $3, $4::jsonb, $5)`,
      ALICE,
      lessonOf[ALICE],
      graded,
      scene,
      feedback,
    );

  it("accepts a review with the drawing it reviewed and its overall sentence", async () => {
    await expect(review("review", "[]", "Clear split, no cache.")).resolves.toBe(1);
  });

  it("refuses a review with no drawing, and a test run with one", async () => {
    // Who decided "passed" is recorded, and a review is only a review of something.
    await expect(review("review", null)).rejects.toThrow(/exercise_attempts_scene_means_review/u);
    await expect(review("tests", "[]")).rejects.toThrow(/exercise_attempts_scene_means_review/u);
  });

  it("accepts a learner's own report of a task, with no drawing", async () => {
    await expect(review("self", null)).resolves.toBe(1);
  });

  it("refuses a grader the product does not know, and feedback on a test run", async () => {
    await expect(review("vibes", null)).rejects.toThrow(/exercise_attempts_graded_by_known/u);
    await expect(review("tests", null, "nice")).rejects.toThrow(
      /exercise_attempts_feedback_shape/u,
    );
  });

  it("refuses a scene that is not a list of elements", async () => {
    await expect(review("review", "{}")).rejects.toThrow(/exercise_attempts_scene_shape/u);
  });
});

describe("lessons.exercises", () => {
  it("defaults to an empty array, so every lesson written before Phase 1 has none", async () => {
    const [row] = await admin.$queryRawUnsafe<{ exercises: unknown }[]>(
      `select exercises from lessons where id = $1::uuid`,
      lessonOf[ALICE],
    );

    expect(row!.exercises).toEqual([]);
  });

  it("refuses anything but an array", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `update lessons set exercises = '{}'::jsonb where id = $1::uuid`,
        lessonOf[ALICE],
      ),
    ).rejects.toThrow(/lessons_exercises_is_array/u);
  });
});

async function seedLessonForCascade(): Promise<string> {
  const [row] = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into lessons (id, user_id, mission_id, seq, slug, title, storage_path, content_hash,
       created_at, updated_at)
     select gen_random_uuid(), user_id, mission_id, 2, 'doomed', 'Doomed',
       'lessons/0002-doomed.html', 'sha', now(), now()
       from lessons where id = $1::uuid
     returning id`,
    lessonOf[ALICE],
  );
  return row!.id;
}
