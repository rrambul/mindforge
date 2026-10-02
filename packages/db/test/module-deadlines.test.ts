import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";

/**
 * `module_deadlines` (FR-U2) and `lessons.kind` (FR-E1): isolation, and the
 * constraints that carry the design.
 *
 * The same hole `exercise_attempts` closes: the insert policy checks the **track**
 * as well as the owner, so a learner cannot hang a deadline off another user's
 * module id. Measured the same way — remove the track half of the insert policy and
 * "refuses a deadline of your own on another user's module" is the one test that
 * fails.
 */

const ADMIN_URL =
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Distinct from every other suite's pair — the delete-by-id sweep below is per file.
const ALICE = "e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5";
const BOB = "e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6";

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

const trackOf: Record<string, string> = {};
const missionOf: Record<string, string> = {};

const INSERT = `insert into module_deadlines (user_id, track_id, due_on)
  values ($1::uuid, $2::uuid, $3::date) returning id`;

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

async function seedTrack(userId: string): Promise<{ missionId: string; trackId: string }> {
  const [mission] = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2, 'active', $2, now(), now()) returning id`,
    userId,
    `${userId}-mission`,
  );
  const [track] = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into tracks (id, user_id, mission_id, slug, name, position, status, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, 'ownership', 'Ownership', 1, 'active', now(), now())
     returning id`,
    userId,
    mission!.id,
  );
  return { missionId: mission!.id, trackId: track!.id };
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  for (const user of [ALICE, BOB]) {
    await seedUser(user);
    const { missionId, trackId } = await seedTrack(user);
    trackOf[user] = trackId;
    missionOf[user] = missionId;
    await admin.$executeRawUnsafe(INSERT, user, trackId, "2026-10-14");
  }
});

afterAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  await admin.$disconnect();
});

describe("row-level security on module_deadlines", () => {
  it("shows each user only their own deadlines", async () => {
    const rows = await asUser<{ user_id: string }[]>(ALICE, `select user_id from module_deadlines`);

    expect(rows.map((r) => r.user_id)).toEqual([ALICE]);
  });

  it("lets a learner commit a deadline on their own module", async () => {
    const rows = await asUser<unknown[]>(ALICE, INSERT, ALICE, trackOf[ALICE], "2026-10-20");

    expect(rows).toHaveLength(1);
  });

  it("refuses a deadline owned by someone else", async () => {
    await expect(asUser(ALICE, INSERT, BOB, trackOf[BOB], "2026-10-20")).rejects.toThrow(
      /row-level security/u,
    );
  });

  it("refuses a deadline of your own on another user's module", async () => {
    await expect(asUser(ALICE, INSERT, ALICE, trackOf[BOB], "2026-10-20")).rejects.toThrow(
      /row-level security/u,
    );
  });

  it("does not let a deadline be rewritten, even by its owner", async () => {
    // A move is a new row. Rewriting the first one would turn "moved twice" into
    // "kept the date it was given".
    const updated = await asUser<unknown[]>(
      ALICE,
      `update module_deadlines set due_on = '2026-12-31' where user_id = $1::uuid returning id`,
      ALICE,
    );

    expect(updated).toEqual([]);
  });

  it("lets the owner delete their own, and nobody else's", async () => {
    const deleted = await asUser<unknown[]>(
      ALICE,
      `delete from module_deadlines where user_id = $1::uuid returning id`,
      BOB,
    );
    expect(deleted).toEqual([]);

    const bobs = await admin.$queryRawUnsafe<unknown[]>(
      `select id from module_deadlines where user_id = $1::uuid`,
      BOB,
    );
    expect(bobs).toHaveLength(1);
  });

  it("refuses a date in the wrong century", async () => {
    await expect(
      admin.$executeRawUnsafe(INSERT, ALICE, trackOf[ALICE], "2206-10-14"),
    ).rejects.toThrow(/module_deadlines_due_on_plausible/u);
  });
});

describe("lessons.kind", () => {
  const insertLesson = (kind: string, status: string, seq: number) =>
    admin.$executeRawUnsafe(
      `insert into lessons (id, user_id, mission_id, track_id, seq, slug, title, status, kind,
         storage_path, content_hash, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, 'exam-ownership', 'Exam',
         $5, $6, $7, $8, now(), now())`,
      ALICE,
      missionOf[ALICE],
      trackOf[ALICE],
      status === "planned" ? null : seq,
      status,
      kind,
      status === "planned" ? null : `lessons/${String(seq).padStart(4, "0")}-exam.html`,
      status === "planned" ? null : "sha",
    );

  it("defaults to a lesson and accepts an exam", async () => {
    await insertLesson("exam", "generated", 9);

    const rows = await admin.$queryRawUnsafe<{ kind: string }[]>(
      `select kind from lessons where user_id = $1::uuid`,
      ALICE,
    );
    expect(rows.map((row) => row.kind)).toEqual(["exam"]);
  });

  it("refuses a kind nobody has heard of", async () => {
    await expect(insertLesson("quiz", "generated", 10)).rejects.toThrow(/lessons_kind_known/u);
  });

  it("refuses a planned exam — the plan does not plan exams", async () => {
    await expect(insertLesson("exam", "planned", 11)).rejects.toThrow(/lessons_exam_shape/u);
  });
});
