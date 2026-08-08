import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";

/**
 * The M2 tables: isolation, and the constraints that hold their shape.
 *
 * Two suites, and both are mandatory rather than nice to have.
 *
 * **Isolation** is CLAUDE.md's second non-negotiable — a new table ships with a
 * policy and a test proving user A cannot read or write user B's rows. The
 * existing `rls.test.ts` already fails if a table has no policy at all, but a
 * policy that exists and a policy that works are different claims, and the one
 * that matters is the second. The loop below drives every new table through the
 * same four proofs rather than trusting six copies of a `format()` call in a
 * migration to have all been right.
 *
 * **Constraints** matter here more than usual because §3.3's own definition of
 * `weekly_allocations` does not compile: it declares a primary key over two
 * nullable columns. The invariants it was reaching for are now a check and two
 * partial unique indexes, which are exactly the kind of thing that can be
 * written slightly wrong and never noticed until plan-vs-actual quietly doubles
 * a target.
 */

const ADMIN_URL =
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const ALICE = "44444444-4444-4444-8444-444444444444";
const BOB = "55555555-5555-4555-8555-555555555555";

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

/**
 * One row per user per table, described once.
 *
 * `identity` is the column that differs between Alice's row and Bob's, so a
 * leak is visible as a value rather than as a count — a test that only asserts
 * "one row" passes just as happily when it is the wrong one.
 */
interface TableCase {
  readonly table: string;
  readonly identity: string;
  /** Inserts one row for `userId`, discriminated by `mark`. */
  readonly insert: (userId: string, mark: string) => [string, unknown[]];
}

const CASES: readonly TableCase[] = [
  {
    table: "weekly_plans",
    identity: "week_start::text",
    insert: (userId, mark) => [
      `insert into weekly_plans (id, user_id, week_start, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $2::date, now(), now())`,
      [userId, mark],
    ],
  },
  {
    table: "weekly_reviews",
    identity: "changed_one_thing",
    insert: (userId, mark) => [
      `insert into weekly_reviews (id, user_id, week_start, changed_one_thing)
       values (gen_random_uuid(), $1::uuid, '2026-03-02'::date, $2)`,
      [userId, mark],
    ],
  },
  {
    table: "daily_activity",
    identity: "focus_minutes::text",
    insert: (userId, mark) => [
      `insert into daily_activity (user_id, day, focus_minutes)
       values ($1::uuid, '2026-03-02'::date, $2::int)`,
      [userId, mark],
    ],
  },
  {
    table: "notification_prefs",
    identity: "config->>'mark'",
    insert: (userId, mark) => [
      `insert into notification_prefs (user_id, kind, config)
       values ($1::uuid, 'stall', jsonb_build_object('mark', $2::text))`,
      [userId, mark],
    ],
  },
  {
    table: "notifications",
    identity: "dedupe_key",
    insert: (userId, mark) => [
      `insert into notifications (id, user_id, kind, dedupe_key)
       values (gen_random_uuid(), $1::uuid, 'stall', $2)`,
      [userId, mark],
    ],
  },
];

/** Distinct per user so a leak reads as the wrong value, not as an extra row. */
const MARKS: Record<string, string> = {
  weekly_plans: "2026-01-05",
  weekly_reviews: "alice-changed",
  daily_activity: "11",
  notification_prefs: "alice",
  notifications: "alice-key",
};
/**
 * A valid mark that collides with neither user's row, for the planted-insert proof.
 *
 * Separate from the two above precisely because reusing them is what made that proof vacuous: a
 * value that cannot be cast, or that trips a unique index, throws before the policy is asked.
 */
const PLANTED: Record<string, string> = {
  weekly_plans: "2026-02-16",
  weekly_reviews: "planted-changed",
  daily_activity: "33",
  notification_prefs: "planted",
  notifications: "planted-key",
};

const BOB_MARKS: Record<string, string> = {
  weekly_plans: "2026-01-12",
  weekly_reviews: "bob-changed",
  daily_activity: "22",
  notification_prefs: "bob",
  notifications: "bob-key",
};

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

beforeAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  await seedUser(ALICE);
  await seedUser(BOB);

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
  it("shows each user only their own rows", async () => {
    const alice = await asUser<{ v: string }[]>(ALICE, `select ${identity} as v from ${table}`);
    const bob = await asUser<{ v: string }[]>(BOB, `select ${identity} as v from ${table}`);

    expect(alice.map((r) => r.v)).toEqual([MARKS[table]]);
    expect(bob.map((r) => r.v)).toEqual([BOB_MARKS[table]]);
  });

  it("returns nothing when reading another user's row by user_id", async () => {
    // The obvious attack on a table whose whole key is (user_id, something):
    // ask for the other user's rows directly rather than relying on the
    // implicit filter.
    const stolen = await asUser<unknown[]>(
      ALICE,
      `select ${identity} as v from ${table} where user_id = $1::uuid`,
      BOB,
    );
    expect(stolen).toHaveLength(0);
  });

  it("silently affects zero rows when updating another user's data", async () => {
    // Alice attempts to take ownership, which is a real mutation. It used to be
    // `set user_id = user_id` — a no-op that cannot fail even if `USING` were widened to `true`, so
    // the assertion below could never have caught a broken read policy. This one can: with `USING
    // (true)` Alice would match Bob's row and move it to herself, and Bob's would vanish.
    await asUser(
      ALICE,
      `update ${table} set user_id = $2::uuid where user_id = $1::uuid`,
      BOB,
      ALICE,
    );
    const bobAfter = await asUser<{ v: string }[]>(BOB, `select ${identity} as v from ${table}`);
    expect(bobAfter.map((r) => r.v)).toEqual([BOB_MARKS[table]]);
  });

  it("refuses to delete another user's data", async () => {
    await asUser(ALICE, `delete from ${table} where user_id = $1::uuid`, BOB);
    const bobAfter = await asUser<unknown[]>(BOB, `select 1 from ${table}`);
    expect(bobAfter).toHaveLength(1);
  });

  it("refuses to insert a row owned by someone else", async () => {
    // The WITH CHECK half. Without it Alice can write into Bob's account even though she cannot
    // read it back, which is worse than a read leak: it corrupts data nobody is looking at.
    //
    // **This test used to pass for the wrong reason on four of the five tables.** It reused each
    // case's mark, so `weekly_plans` cast "planted" through `::date` and `daily_activity` through
    // `::int` — both syntax errors — while `weekly_reviews` and `notification_prefs` collided with
    // Bob's existing unique row. Every one of them threw, none of them reached the policy, and
    // stripping every `with check` from the migration left the suite green. Verified by doing
    // exactly that.
    //
    // So the planted row is now valid and non-colliding, and the assertion names the error: only a
    // policy violation says "row-level security", and nothing else Postgres raises here does.
    const [sql, params] = CASES.find((c) => c.table === table)!.insert(BOB, PLANTED[table]!);
    await expect(asUser(ALICE, sql, ...params)).rejects.toThrow(/row-level security/i);
  });
});

describe("weekly_allocations", () => {
  let planId: string;

  beforeAll(async () => {
    const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
      `select id from weekly_plans where user_id = $1::uuid`,
      ALICE,
    );
    planId = rows[0]!.id;
  });

  async function allocate(
    userId: string,
    plan: string,
    missionId: string | null,
    skillId: string | null,
    minutes: number,
  ) {
    return admin.$executeRawUnsafe(
      `insert into weekly_allocations (id, user_id, plan_id, mission_id, skill_id, planned_minutes)
       values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::int)`,
      userId,
      plan,
      missionId,
      skillId,
      minutes,
    );
  }

  async function mission(userId: string, topic: string): Promise<string> {
    const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into missions (id, user_id, topic, status, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $2, 'active', now(), now()) returning id`,
      userId,
      topic,
    );
    return rows[0]!.id;
  }

  async function skill(userId: string, slug: string): Promise<string> {
    const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into skills (id, user_id, name, slug, created_at)
       values (gen_random_uuid(), $1::uuid, $2, $2, now()) returning id`,
      userId,
      slug,
    );
    return rows[0]!.id;
  }

  it("refuses an allocation with no subject", async () => {
    // §3.3's composite primary key was meant to guarantee this and could not:
    // in Postgres a null in a primary key column is not a wildcard, it is an
    // error at table-creation time. So the rule is stated as a check instead.
    await expect(allocate(ALICE, planId, null, null, 120)).rejects.toThrow();
  });

  it("refuses an allocation against both a mission and a skill", async () => {
    // Would be counted twice by plan-vs-actual: once under the mission's
    // actual minutes and once under the skill's.
    const m = await mission(ALICE, "both-subjects");
    const s = await skill(ALICE, "both-subjects");
    await expect(allocate(ALICE, planId, m, s, 120)).rejects.toThrow();
  });

  it("refuses a zero or negative target", async () => {
    // Zero is the absence of an allocation, not an allocation of nothing. A
    // grid full of zeroes makes plan-vs-actual list weeks of things you never
    // intended to do.
    const m = await mission(ALICE, "zero-minutes");
    await expect(allocate(ALICE, planId, m, null, 0)).rejects.toThrow();
    await expect(allocate(ALICE, planId, m, null, -30)).rejects.toThrow();
  });

  it("allows one allocation per mission per plan and refuses the second", async () => {
    const m = await mission(ALICE, "one-per-mission");
    await allocate(ALICE, planId, m, null, 120);
    await expect(allocate(ALICE, planId, m, null, 90)).rejects.toThrow();
  });

  it("allows one allocation per skill per plan and refuses the second", async () => {
    // A separate proof from the mission case rather than an assumed symmetry:
    // these are two partial indexes, and a `where` clause on the wrong column
    // makes one of them enforce nothing while the other looks fine.
    const s = await skill(ALICE, "one-per-skill");
    await allocate(ALICE, planId, null, s, 120);
    await expect(allocate(ALICE, planId, null, s, 90)).rejects.toThrow();
  });

  it("lets a mission and a skill hold separate allocations in the same plan", async () => {
    // The partial indexes must not collide with each other. Both rows have a
    // null in the column the other index keys on, and a non-partial unique
    // index over (plan_id, mission_id, skill_id) would have treated those nulls
    // as distinct and enforced nothing at all.
    const m = await mission(ALICE, "coexist-mission");
    const s = await skill(ALICE, "coexist-skill");
    await allocate(ALICE, planId, m, null, 120);
    await allocate(ALICE, planId, null, s, 60);

    const rows = await asUser<{ n: bigint }[]>(
      ALICE,
      `select count(*) as n from weekly_allocations where plan_id = $1::uuid
         and (mission_id = $2::uuid or skill_id = $3::uuid)`,
      planId,
      m,
      s,
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it("isolates allocations from another user", async () => {
    const m = await mission(ALICE, "isolated");
    await allocate(ALICE, planId, m, null, 45);

    const seen = await asUser<unknown[]>(BOB, `select id from weekly_allocations`);
    expect(seen).toHaveLength(0);
  });

  it("disappears with the mission it allocates to", async () => {
    // Cascade rather than set-null: an allocation whose subject is gone is a
    // planned number against nothing, and plan-vs-actual would have to invent a
    // label for it.
    const m = await mission(ALICE, "doomed");
    await allocate(ALICE, planId, m, null, 30);
    await admin.$executeRawUnsafe(`delete from missions where id = $1::uuid`, m);

    const left = await asUser<unknown[]>(
      ALICE,
      `select id from weekly_allocations where mission_id = $1::uuid`,
      m,
    );
    expect(left).toHaveLength(0);
  });
});

describe("notifications", () => {
  it("refuses a second notification with the same dedupe key", async () => {
    // This is what makes the nightly job safe to re-run. Without it, a stall
    // that has been true for a week produces seven identical nudges, and the
    // app that promised to be quiet is the loudest thing on the screen.
    await expect(
      admin.$executeRawUnsafe(
        `insert into notifications (id, user_id, kind, dedupe_key)
         values (gen_random_uuid(), $1::uuid, 'stall', $2)`,
        ALICE,
        MARKS["notifications"]!,
      ),
    ).rejects.toThrow();
  });

  it("lets two users hold the same dedupe key", async () => {
    // Uniqueness is per user. A key like "stall:<missionId>:<weekStart>" is
    // already unique in practice, but scoping it to the user is what keeps one
    // account's nudges from suppressing another's.
    const rows = await admin.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from notifications where dedupe_key in ($1, $2)`,
      MARKS["notifications"]!,
      BOB_MARKS["notifications"]!,
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it("refuses a kind nothing knows how to render", async () => {
    // `kind` is the i18n message key. An unknown kind is a notification the SPA
    // can only render as a missing translation, which is worse than not
    // creating it.
    await expect(
      admin.$executeRawUnsafe(
        `insert into notifications (id, user_id, kind, dedupe_key)
         values (gen_random_uuid(), $1::uuid, 'surprise', 'surprise-key')`,
        ALICE,
      ),
    ).rejects.toThrow();
  });
});

describe("daily_activity", () => {
  it("holds one row per user per day", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `insert into daily_activity (user_id, day, focus_minutes)
         values ($1::uuid, '2026-03-02'::date, 99)`,
        ALICE,
      ),
    ).rejects.toThrow();
  });

  it("keeps ember and slag separate from focus rather than summing to it", async () => {
    // Not a constraint, a documented shape: a frictionless session adds to
    // focus_minutes and to neither of the other two. Pinned because the
    // tempting "fix" is a check that they add up, which would force the rollup
    // to call unexamined time ember.
    await admin.$executeRawUnsafe(
      `insert into daily_activity (user_id, day, focus_minutes, ember_minutes, slag_minutes)
       values ($1::uuid, '2026-03-03'::date, 120, 30, 10)`,
      ALICE,
    );
    const rows = await asUser<{ f: number; e: number; s: number }[]>(
      ALICE,
      `select focus_minutes as f, ember_minutes as e, slag_minutes as s
         from daily_activity where day = '2026-03-03'::date`,
    );
    expect(rows[0]).toEqual({ f: 120, e: 30, s: 10 });
  });
});
