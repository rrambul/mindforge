import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";

/**
 * `exercise_hints` (FR-H3): isolation, and the constraints that carry the design.
 *
 * The same shape as `exercise_attempts`, and the same hole to close: the insert
 * policy checks the lesson as well as the owner, so a learner cannot hang hints
 * off another user's lesson id. Measured the same way — remove the lesson half of
 * the insert policy and "refuses a hint of your own on another user's lesson" is
 * the one test that fails.
 */

const ADMIN_URL =
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Distinct from every other suite's pair — the delete-by-id sweep below is per file.
const ALICE = "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3";
const BOB = "e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4";

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

const INSERT = `insert into exercise_hints (user_id, lesson_id, exercise_key, level, question, answer)
  values ($1::uuid, $2::uuid, $3, $4::smallint, $5, $6) returning id`;

function hint(
  userId: string,
  lessonId: string,
  over: Partial<{ key: string; level: number; question: string | null; answer: string }> = {},
): unknown[] {
  return [
    userId,
    lessonId,
    over.key ?? "commit-index",
    over.level ?? 1,
    over.question ?? null,
    over.answer ?? `a question for ${userId}`,
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
     values (gen_random_uuid(), $1::uuid, $2::uuid, 1, 'raft', 'Raft',
       'lessons/0001-raft.html', 'sha', now(), now())
     returning id`,
    userId,
    mission!.id,
  );
  return lesson!.id;
}

async function count(sql: string, ...params: unknown[]): Promise<number> {
  const [row] = await admin.$queryRawUnsafe<{ count: bigint }[]>(sql, ...params);
  return Number(row!.count);
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  for (const user of [ALICE, BOB]) {
    await seedUser(user);
    const lesson = await seedLesson(user);
    lessonOf[user] = lesson;
    await admin.$executeRawUnsafe(INSERT, ...hint(user, lesson));
  }
});

afterAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  await admin.$disconnect();
});

describe("row-level security on exercise_hints", () => {
  it("shows each user only their own hints", async () => {
    const rows = await asUser<{ answer: string }[]>(ALICE, `select answer from exercise_hints`);

    expect(rows.map((r) => r.answer)).toEqual([`a question for ${ALICE}`]);
  });

  it("lets a learner record a hint on their own lesson", async () => {
    const rows = await asUser<unknown[]>(
      ALICE,
      INSERT,
      ...hint(ALICE, lessonOf[ALICE]!, { level: 2 }),
    );

    expect(rows).toHaveLength(1);
  });

  it("refuses a hint owned by someone else", async () => {
    await expect(asUser(ALICE, INSERT, ...hint(BOB, lessonOf[BOB]!))).rejects.toThrow(
      /row-level security/u,
    );
  });

  it("refuses a hint of your own on another user's lesson", async () => {
    await expect(asUser(ALICE, INSERT, ...hint(ALICE, lessonOf[BOB]!))).rejects.toThrow(
      /row-level security/u,
    );
  });

  it("does not let a hint be rewritten, even by its owner", async () => {
    // "How far up the ladder did they go" is Phase 3's signal; lowering a level
    // after the fact would turn "was shown the code" into "worked it out".
    const updated = await asUser<unknown[]>(
      ALICE,
      `update exercise_hints set level = 1 where user_id = $1::uuid returning id`,
      ALICE,
    );

    expect(updated).toEqual([]);
  });

  it("refuses to delete another user's hints", async () => {
    await asUser(ALICE, `delete from exercise_hints where user_id = $1::uuid`, BOB);

    expect(await count(`select count(*) from exercise_hints where user_id = $1::uuid`, BOB)).toBe(
      1,
    );
  });
});

describe("the constraints on exercise_hints", () => {
  const insertAsAdmin = (over: Parameters<typeof hint>[2]) =>
    admin.$executeRawUnsafe(INSERT, ...hint(ALICE, lessonOf[ALICE]!, over));

  it.each([0, 6])("refuses rung %i, which the ladder does not have", async (level) => {
    await expect(insertAsAdmin({ level })).rejects.toThrow(/exercise_hints_level/u);
  });

  it("records opening the solution only as the top rung, with no question and no bill", async () => {
    const reveal = (level: number, question: string | null) =>
      admin.$executeRawUnsafe(
        `insert into exercise_hints (user_id, lesson_id, exercise_key, kind, level, question, answer)
         values ($1::uuid, $2::uuid, 'commit-index', 'solution', $3::smallint, $4, 'the solution')`,
        ALICE,
        lessonOf[ALICE],
        level,
        question,
      );

    await expect(reveal(5, null)).resolves.toBe(1);
    // A reveal below the top rung would let "saw the answer" count as a nudge.
    await expect(reveal(2, null)).rejects.toThrow(/exercise_hints_solution_shape/u);
    await expect(reveal(5, "why?")).rejects.toThrow(/exercise_hints_solution_shape/u);
  });

  it("refuses a kind of help the product does not know", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `insert into exercise_hints (user_id, lesson_id, exercise_key, kind, level, answer)
         values ($1::uuid, $2::uuid, 'commit-index', 'guess', 1, 'x')`,
        ALICE,
        lessonOf[ALICE],
      ),
    ).rejects.toThrow(/exercise_hints_kind_known/u);
  });

  it("refuses an empty answer, which helped nobody", async () => {
    await expect(insertAsAdmin({ answer: "" })).rejects.toThrow(/exercise_hints_answer_nonempty/u);
  });

  it("refuses an empty question rather than storing one", async () => {
    await expect(insertAsAdmin({ question: "" })).rejects.toThrow(/exercise_hints_question_size/u);
  });

  it("keeps the hint when its cost row goes, and the other way round", async () => {
    const [call] = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into llm_calls (id, user_id, purpose, model, created_at)
       values (gen_random_uuid(), $1::uuid, 'exercise_hint', 'claude-opus-5', now()) returning id`,
      ALICE,
    );
    const [row] = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into exercise_hints (user_id, lesson_id, exercise_key, level, answer, llm_call_id)
       values ($1::uuid, $2::uuid, 'commit-index', 3, 'the concept', $3::uuid) returning id`,
      ALICE,
      lessonOf[ALICE],
      call!.id,
    );

    await admin.$executeRawUnsafe(`delete from llm_calls where id = $1::uuid`, call!.id);

    expect(
      await count(
        `select count(*) from exercise_hints where id = $1::uuid and llm_call_id is null`,
        row!.id,
      ),
    ).toBe(1);
  });

  it("goes with its lesson", async () => {
    const [doomed] = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into lessons (id, user_id, mission_id, seq, slug, title, storage_path, content_hash,
         created_at, updated_at)
       select gen_random_uuid(), user_id, mission_id, 2, 'doomed', 'Doomed',
         'lessons/0002-doomed.html', 'sha', now(), now()
         from lessons where id = $1::uuid
       returning id`,
      lessonOf[ALICE],
    );
    await admin.$executeRawUnsafe(INSERT, ...hint(ALICE, doomed!.id));
    await admin.$executeRawUnsafe(`delete from lessons where id = $1::uuid`, doomed!.id);

    expect(
      await count(`select count(*) from exercise_hints where lesson_id = $1::uuid`, doomed!.id),
    ).toBe(0);
  });
});
