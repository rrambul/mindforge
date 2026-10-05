import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";

/**
 * The two shapes this milestone's tables carry (FR-B1, FR-E1): a mission's calendar
 * is both of its facts or neither, and an exam is always a written lesson.
 *
 * No new table, so no new RLS policy: `weeks` and `starts_on` are columns on
 * `missions`, whose policies `rls.test.ts` already proves. `module_deadlines` was
 * dropped by `20261004120000_weekly_missions`, and the test that it is gone is here.
 */

const ADMIN_URL =
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Distinct from every other suite's pair — the delete-by-id sweep below is per file.
const ALICE = "e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5";
const BOB = "e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6";

const admin = createPrismaClient(ADMIN_URL);

const trackOf: Record<string, string> = {};
const missionOf: Record<string, string> = {};

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
  }
});

afterAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  await admin.$disconnect();
});

describe("missions_calendar_shape", () => {
  const insertMission = (weeks: number | null, startsOn: string | null) =>
    admin.$executeRawUnsafe(
      `insert into missions (id, user_id, topic, status, weeks, starts_on, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, 'Weeks', 'active', $2::smallint, $3::date, now(), now())`,
      ALICE,
      weeks,
      startsOn,
    );

  it("takes both facts, or neither for a mission from before weeks", async () => {
    await expect(insertMission(6, "2026-10-05")).resolves.toBe(1);
    await expect(insertMission(null, null)).resolves.toBe(1);
  });

  it("refuses a length with no start, or a start with no length", async () => {
    await expect(insertMission(6, null)).rejects.toThrow(/missions_calendar_shape/u);
    await expect(insertMission(null, "2026-10-05")).rejects.toThrow(/missions_calendar_shape/u);
  });

  it("refuses a length outside one to fifty-two weeks", async () => {
    await expect(insertMission(0, "2026-10-05")).rejects.toThrow(/missions_calendar_shape/u);
    await expect(insertMission(53, "2026-10-05")).rejects.toThrow(/missions_calendar_shape/u);
  });

  it("has no module_deadlines table any more — the calendar replaced it", async () => {
    const [row] = await admin.$queryRawUnsafe<{ exists: boolean }[]>(
      `select to_regclass('public.module_deadlines') is not null as exists`,
    );
    expect(row!.exists).toBe(false);
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

describe("tracks.week (FR-B4)", () => {
  const insertTrack = (slug: string, week: number | null) =>
    admin.$executeRawUnsafe(
      `insert into tracks (id, user_id, mission_id, slug, name, position, status, week, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $2::uuid, $3, $3, 9, 'proposed', $4::smallint, now(), now())`,
      ALICE,
      missionOf[ALICE],
      slug,
      week,
    );

  it("gives one module per week of a mission, whatever the plan does later", async () => {
    await expect(insertTrack("week-three", 3)).resolves.toBe(1);
    await expect(insertTrack("also-three", 3)).rejects.toThrow(/tracks_one_per_week_key/u);
    // No calendar, no week: as many as you like.
    await expect(insertTrack("no-week-a", null)).resolves.toBe(1);
    await expect(insertTrack("no-week-b", null)).resolves.toBe(1);
  });

  it("refuses a week outside one to fifty-two", async () => {
    await expect(insertTrack("week-zero", 0)).rejects.toThrow(/tracks_week_range/u);
    await expect(insertTrack("week-53", 53)).rejects.toThrow(/tracks_week_range/u);
  });
});
