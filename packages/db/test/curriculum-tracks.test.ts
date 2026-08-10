import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";

/**
 * The curriculum tables: isolation, and the constraints that carry the design.
 *
 * **Isolation** is CLAUDE.md's second non-negotiable. Three of these four tables
 * are join tables carrying a denormalised `user_id`, which is the shape most
 * likely to be added later without a policy — the join looks like plumbing rather
 * than like data, right up until `lesson_skills` is the thing that decides which
 * skill somebody's evidence lands on.
 *
 * **Constraints** matter more than usual on `tracks`, because two of them encode
 * decisions that are otherwise only prose:
 *
 * - `tracks_one_active_per_mission_key` is what keeps lazy lesson generation
 *   coherent. Lessons are written one at a time into the open module; two open
 *   modules is the half-finished backlog the weekly review already measures.
 * - `tracks_mission_id_slug_key` is per **mission**, never global. A global unique
 *   would let the first account to claim `fundamentals` take it from everyone and
 *   leak, through the 409, that it had — the mistake `missions.workspace_key`
 *   shipped with and 20260808120000 corrected.
 *
 * **Measured, not argued.** The insert proofs here were checked the way the M3
 * suite's were, by breaking the policies and counting:
 *
 *   `with check (true)` on all four tables → 4 failures, one per table
 *   `using (true)` on all four tables      → 16 failures, four per table
 *
 * Every table discriminates on both halves. Without that check an insert proof
 * can pass because the planted row failed to cast or tripped a unique index,
 * which is how four of the M2 suite's five became vacuous.
 */

const ADMIN_URL =
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Distinct from every other suite's pair: vitest.config.ts sets
// fileParallelism: false, but the delete-by-id sweep in beforeAll is per file and
// would otherwise wipe another suite's users mid-run.
const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

/** Per-user fixtures, so every foreign key points at something that is theirs. */
const missionOf: Record<string, string> = {};
const trackOf: Record<string, string> = {};
const prereqOf: Record<string, string> = {};
const skillOf: Record<string, string> = {};
const lessonOf: Record<string, string> = {};

interface TableCase {
  readonly table: string;
  /** The column that differs between Alice's row and Bob's, so a leak reads as a value. */
  readonly identity: string;
  readonly insert: (userId: string, mark: string) => [string, unknown[]];
}

const CASES: readonly TableCase[] = [
  {
    table: "tracks",
    identity: "slug",
    insert: (userId, mark) => [
      `insert into tracks (id, user_id, mission_id, slug, name, outcome, position, status,
         created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $2::uuid, $3, $3, 'do a thing', $4::int, 'proposed',
         now(), now())`,
      [userId, missionOf[userId], mark, positionOf(mark)],
    ],
  },
  {
    table: "track_edges",
    identity: "track_id",
    insert: (userId) => [
      `insert into track_edges (user_id, track_id, prereq_id) values ($1::uuid, $2::uuid, $3::uuid)`,
      [userId, trackOf[userId], prereqOf[userId]],
    ],
  },
  {
    table: "track_skills",
    identity: "track_id",
    insert: (userId) => [
      `insert into track_skills (user_id, track_id, skill_id) values ($1::uuid, $2::uuid, $3::uuid)`,
      [userId, trackOf[userId], skillOf[userId]],
    ],
  },
  {
    table: "lesson_skills",
    identity: "lesson_id",
    insert: (userId) => [
      `insert into lesson_skills (user_id, lesson_id, skill_id) values ($1::uuid, $2::uuid, $3::uuid)`,
      [userId, lessonOf[userId], skillOf[userId]],
    ],
  },
];

/** `position` is NOT NULL, and `(mission_id, slug)` is unique, so marks differ. */
function positionOf(mark: string): number {
  const digits = /(\d+)/u.exec(mark);
  return digits ? Number(digits[1]) : 1;
}

const MARKS: Record<string, string> = {
  tracks: "alice-track-1",
  track_edges: "",
  track_skills: "",
  lesson_skills: "",
};

const BOB_MARKS: Record<string, string> = {
  tracks: "bob-track-2",
  track_edges: "",
  track_skills: "",
  lesson_skills: "",
};

/**
 * A valid mark that collides with neither user's row, for the planted-insert
 * proof.
 *
 * The three join tables take no mark: their primary key is the pair of foreign
 * keys, so a planted insert reuses Bob's own ids and can only be refused by the
 * `WITH CHECK` half. That is exactly what is under test — the rows Alice plants
 * there are the ones she cannot read back afterwards.
 */
const PLANTED: Record<string, string> = {
  tracks: "planted-track-9",
  track_edges: "",
  track_skills: "",
  lesson_skills: "",
};

/** The identity value each user's seeded join row carries, for the read proofs. */
const JOIN_IDENTITY: Record<string, Record<string, () => string>> = {
  track_edges: { [ALICE]: () => trackOf[ALICE]!, [BOB]: () => trackOf[BOB]! },
  track_skills: { [ALICE]: () => trackOf[ALICE]!, [BOB]: () => trackOf[BOB]! },
  lesson_skills: { [ALICE]: () => lessonOf[ALICE]!, [BOB]: () => lessonOf[BOB]! },
};

function expected(table: string, userId: string): string {
  const join = JOIN_IDENTITY[table];
  if (join) return join[userId]!();
  return userId === ALICE ? MARKS[table]! : BOB_MARKS[table]!;
}

async function seedUser(id: string) {
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

async function seedMission(userId: string, key: string): Promise<string> {
  const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2, 'active', $2, now(), now()) returning id`,
    userId,
    key,
  );
  return rows[0]!.id;
}

async function seedTrack(
  userId: string,
  slug: string,
  position: number,
  status = "proposed",
  mission = missionOf[userId],
): Promise<string> {
  const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into tracks (id, user_id, mission_id, slug, name, position, status, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, $3, $3, $4::int, $5, now(), now()) returning id`,
    userId,
    mission,
    slug,
    position,
    status,
  );
  return rows[0]!.id;
}

async function seedSkill(userId: string, slug: string): Promise<string> {
  const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into skills (id, user_id, name, slug, band)
     values (gen_random_uuid(), $1::uuid, $2, $2, 'aware') returning id`,
    userId,
    slug,
  );
  return rows[0]!.id;
}

async function seedLesson(userId: string, seq: number, trackId: string | null): Promise<string> {
  const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into lessons (id, user_id, mission_id, track_id, seq, slug, title, storage_path,
       content_hash, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::int, $5, $5, $6, 'sha', now(), now())
     returning id`,
    userId,
    missionOf[userId],
    trackId,
    seq,
    `lesson-${seq}`,
    `lessons/000${seq}-lesson.html`,
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  await seedUser(ALICE);
  await seedUser(BOB);

  for (const user of [ALICE, BOB]) {
    missionOf[user] = await seedMission(user, `${user}-mission`);
    // Seeded before the CASES loop, because `tracks`' own case inserts a third
    // track and the two join tables need one that already exists.
    prereqOf[user] = await seedTrack(user, "fundamentals", 1);
    trackOf[user] = await seedTrack(user, "advanced", 2);
    skillOf[user] = await seedSkill(user, `${user}-skill`);
    lessonOf[user] = await seedLesson(user, 1, trackOf[user]);
  }

  for (const c of CASES) {
    const [aliceSql, aliceParams] = c.insert(ALICE, MARKS[c.table]!);
    await admin.$executeRawUnsafe(aliceSql, ...aliceParams);
    const [bobSql, bobParams] = c.insert(BOB, BOB_MARKS[c.table]!);
    await admin.$executeRawUnsafe(bobSql, ...bobParams);
  }
});

afterAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  await admin.$disconnect();
});

describe.each(CASES)("row-level security on $table", ({ table, identity }) => {
  it("returns nothing when reading another user's row by user_id", async () => {
    const stolen = await asUser<unknown[]>(
      ALICE,
      `select ${identity} as v from ${table} where user_id = $1::uuid`,
      BOB,
    );
    expect(stolen).toHaveLength(0);
  });

  it("shows each user only their own rows", async () => {
    const alice = await asUser<{ v: string }[]>(
      ALICE,
      `select ${identity} as v from ${table} where user_id = $1::uuid`,
      ALICE,
    );
    const bob = await asUser<{ v: string }[]>(
      BOB,
      `select ${identity} as v from ${table} where user_id = $1::uuid`,
      BOB,
    );

    expect(alice.map((r) => r.v)).toContain(expected(table, ALICE));
    expect(bob.map((r) => r.v)).toContain(expected(table, BOB));
    expect(alice.map((r) => r.v)).not.toContain(expected(table, BOB));
  });

  it("silently affects zero rows when updating another user's data", async () => {
    // A real mutation, not `set user_id = user_id`: with `USING (true)` Alice
    // would match Bob's row and move it to herself, and Bob's would vanish. A
    // no-op update cannot fail even against a policy that lets everything through.
    await asUser(
      ALICE,
      `update ${table} set user_id = $2::uuid where user_id = $1::uuid`,
      BOB,
      ALICE,
    );
    const bobAfter = await asUser<{ v: string }[]>(
      BOB,
      `select ${identity} as v from ${table} where user_id = $1::uuid`,
      BOB,
    );
    expect(bobAfter.map((r) => r.v)).toContain(expected(table, BOB));
  });

  it("refuses to delete another user's data", async () => {
    await asUser(ALICE, `delete from ${table} where user_id = $1::uuid`, BOB);
    const bobAfter = await asUser<unknown[]>(
      BOB,
      `select 1 from ${table} where user_id = $1::uuid`,
      BOB,
    );
    expect(bobAfter.length).toBeGreaterThan(0);
  });

  it("refuses to insert a row owned by someone else", async () => {
    // The WITH CHECK half. Without it Alice can write into Bob's account even
    // though she cannot read it back — worse than a read leak, because it corrupts
    // data nobody is looking at. On the join tables it is the *only* protection
    // that applies, and `lesson_skills` is where a bad write decides whose skill
    // somebody else's lesson outcome credits.
    //
    // The assertion names the error rather than accepting any throw: only a policy
    // violation says "row-level security", and a planted value that failed to cast
    // or tripped a unique index would satisfy a bare `rejects.toThrow()` without
    // Postgres consulting the policy at all.
    const [sql, params] = CASES.find((c) => c.table === table)!.insert(BOB, PLANTED[table]!);
    await expect(asUser(ALICE, sql, ...params)).rejects.toThrow(/row-level security/iu);
  });
});

describe("tracks: one active track per mission", () => {
  it("refuses a second active track in the same mission", async () => {
    // Lessons are generated one at a time into whichever module is open. Two open
    // modules is the half-finished backlog the weekly review already measures, and
    // it also leaves "the next lesson" with no unambiguous answer.
    const mission = await seedMission(ALICE, "one-active");
    await seedTrack(ALICE, "first", 1, "active", mission);
    await expect(seedTrack(ALICE, "second", 2, "active", mission)).rejects.toThrow();
  });

  it("allows any number of proposed, done and dropped tracks alongside it", async () => {
    // The index is partial for exactly this reason: a curriculum is 8-15 tracks
    // and all but one of them are waiting at any moment.
    const mission = await seedMission(ALICE, "many-proposed");
    await seedTrack(ALICE, "open", 1, "active", mission);
    await expect(seedTrack(ALICE, "waiting", 2, "proposed", mission)).resolves.toBeTruthy();
    await expect(seedTrack(ALICE, "finished", 3, "done", mission)).resolves.toBeTruthy();
    await expect(seedTrack(ALICE, "cut", 4, "dropped", mission)).resolves.toBeTruthy();
  });

  it("lets two different missions each have an active track", async () => {
    const other = await seedMission(ALICE, "other-mission");
    await expect(seedTrack(ALICE, "its-own", 1, "active", other)).resolves.toBeTruthy();
  });

  it("refuses a status nothing in the product knows", async () => {
    await expect(seedTrack(ALICE, "bogus", 9, "probably_fine")).rejects.toThrow();
  });
});

describe("tracks: slugs are scoped to a mission, not to the world", () => {
  it("lets two users both have a `fundamentals` track", async () => {
    // Already true from the fixtures — asserted rather than assumed, because a
    // global unique on a user-chosen slug is a privacy bug wearing a constraint's
    // clothes: the 409 tells the second person that somebody else claimed it.
    const rows = await admin.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from tracks where slug = 'fundamentals' and user_id = any($1::uuid[])`,
      [ALICE, BOB],
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it("lets one user reuse a slug across two of their own missions", async () => {
    const other = await seedMission(ALICE, "slug-reuse");
    await expect(seedTrack(ALICE, "fundamentals", 1, "proposed", other)).resolves.toBeTruthy();
  });

  it("refuses the same slug twice in one mission", async () => {
    // This is the reindexer's upsert key. Without it a regenerated CURRICULUM.md
    // doubles the module list instead of revising it — the RESOURCES.md failure,
    // one table over.
    await expect(seedTrack(ALICE, "fundamentals", 7)).rejects.toThrow();
  });
});

describe("track_edges", () => {
  it("refuses a track that is its own prerequisite", async () => {
    // All a constraint can catch. The rest of the DAG — a two-hop cycle and
    // longer — is checked in the application layer, for the same reason
    // `skill_edges` puts it there.
    await expect(
      admin.$executeRawUnsafe(
        `insert into track_edges (user_id, track_id, prereq_id) values ($1::uuid, $2::uuid, $2::uuid)`,
        ALICE,
        trackOf[ALICE],
      ),
    ).rejects.toThrow();
  });

  it("does not stop a two-hop cycle, which is why the use case must", async () => {
    // Asserted rather than left implicit: this is the gap the application layer
    // covers, and a test that pins it is what stops somebody concluding from the
    // `_not_self` constraint that cycles are handled.
    const a = await seedTrack(ALICE, "cycle-a", 20);
    const b = await seedTrack(ALICE, "cycle-b", 21);
    await admin.$executeRawUnsafe(
      `insert into track_edges (user_id, track_id, prereq_id) values ($1::uuid, $2::uuid, $3::uuid)`,
      ALICE,
      a,
      b,
    );
    await expect(
      admin.$executeRawUnsafe(
        `insert into track_edges (user_id, track_id, prereq_id) values ($1::uuid, $2::uuid, $3::uuid)`,
        ALICE,
        b,
        a,
      ),
    ).resolves.toBeDefined();
  });
});

describe("a track is never the thing that deletes a lesson", () => {
  it("keeps the lesson and clears its module when a track is deleted", async () => {
    // Non-negotiable 6, one table over: losing a lesson is unacceptable. The
    // reindexer marks a vanished track `dropped` rather than deleting it, so this
    // path is only reachable by hand — which is exactly when the foreign key's
    // ON DELETE has to be the cautious one.
    const track = await seedTrack(ALICE, "doomed", 30);
    const lesson = await seedLesson(ALICE, 40, track);

    await admin.$executeRawUnsafe(`delete from tracks where id = $1::uuid`, track);

    const rows = await admin.$queryRawUnsafe<{ track_id: string | null }[]>(
      `select track_id from lessons where id = $1::uuid`,
      lesson,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.track_id).toBeNull();
  });
});
