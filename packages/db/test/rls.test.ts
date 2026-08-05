import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";

/**
 * RLS isolation.
 *
 * This is the mandatory suite from CLAUDE.md: a new table ships with a policy
 * AND a test proving user A cannot read or write user B's rows. Without it,
 * "RLS is enabled" is a claim about configuration, not about behaviour — and
 * the two diverge the first time a policy is written slightly wrong.
 *
 * These run as an unprivileged role. The service-role key used by the worker
 * bypasses RLS entirely by design, which is why every worker query must filter
 * user_id by hand (TECH-DESIGN.md §3.6).
 */

const ADMIN_URL =
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const admin = createPrismaClient(ADMIN_URL);

type TxClient = Omit<
  typeof admin,
  "$transaction" | "$connect" | "$disconnect" | "$on" | "$extends"
>;

/** Runs a query as `authenticated` with the given user's claims. */
function asUser<T>(userId: string, sql: string, ...params: unknown[]): Promise<T> {
  return admin.$transaction(async (tx: TxClient) => {
    await tx.$executeRawUnsafe(`set local role authenticated`);
    await tx.$executeRawUnsafe(
      `select set_config('request.jwt.claims', $1, true)`,
      JSON.stringify({ sub: userId, role: "authenticated" }),
    );
    return (await tx.$queryRawUnsafe(sql, ...params)) as T;
  });
}

beforeAll(async () => {
  // Start from a known state. A run that fails mid-suite never reaches
  // afterAll, and leftover rows would make the next run fail for the wrong
  // reason — which is exactly how a real RLS regression gets misdiagnosed.
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);

  // Seed two users through the auth schema so the signup trigger creates
  // their profiles, exactly as a real signup would.
  for (const id of [ALICE, BOB]) {
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

  await admin.$executeRawUnsafe(
    `insert into missions (id, user_id, topic, status, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'Alice private mission', 'active', now(), now())`,
    ALICE,
  );
  await admin.$executeRawUnsafe(
    `insert into missions (id, user_id, topic, status, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'Bob private mission', 'active', now(), now())`,
    BOB,
  );
});

afterAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  await admin.$disconnect();
});

describe("row-level security", () => {
  it("shows each user only their own missions", async () => {
    const alice = await asUser<{ topic: string }[]>(ALICE, `select topic from missions`);
    const bob = await asUser<{ topic: string }[]>(BOB, `select topic from missions`);

    expect(alice.map((r) => r.topic)).toEqual(["Alice private mission"]);
    expect(bob.map((r) => r.topic)).toEqual(["Bob private mission"]);
  });

  it("hides another user's row even when addressed by primary key", async () => {
    // Knowing the id must not be enough. If this fails, an enumerable id is a
    // data leak rather than merely an ugly URL.
    const [bobRow] = await asUser<{ id: string }[]>(BOB, `select id from missions`);
    const stolen = await asUser<unknown[]>(
      ALICE,
      `select topic from missions where id = $1::uuid`,
      bobRow!.id,
    );
    expect(stolen).toHaveLength(0);
  });

  it("silently affects zero rows when updating another user's data", async () => {
    const [bobRow] = await asUser<{ id: string }[]>(BOB, `select id from missions`);
    await asUser(
      ALICE,
      `update missions set topic = 'hijacked' where id = $1::uuid returning id`,
      bobRow!.id,
    );

    const bobAfter = await asUser<{ topic: string }[]>(BOB, `select topic from missions`);
    expect(bobAfter[0]!.topic).toBe("Bob private mission");
  });

  it("refuses to delete another user's data", async () => {
    const [bobRow] = await asUser<{ id: string }[]>(BOB, `select id from missions`);
    await asUser(ALICE, `delete from missions where id = $1::uuid returning id`, bobRow!.id);

    const bobAfter = await asUser<unknown[]>(BOB, `select id from missions`);
    expect(bobAfter).toHaveLength(1);
  });

  it("refuses to insert a row owned by someone else", async () => {
    // The WITH CHECK half of the policy. Without it, Alice could write rows
    // into Bob's account even though she cannot read them back.
    await expect(
      asUser(
        ALICE,
        `insert into missions (id, user_id, topic, status, created_at, updated_at)
         values (gen_random_uuid(), $1::uuid, 'planted', 'active', now(), now())`,
        BOB,
      ),
    ).rejects.toThrow();
  });

  it("sees nothing at all with no claims set", async () => {
    // An unauthenticated request must not fall back to "everything".
    const rows = await admin.$transaction(async (tx: TxClient) => {
      await tx.$executeRawUnsafe(`set local role authenticated`);
      return tx.$queryRawUnsafe(`select id from missions`);
    });
    expect(rows).toHaveLength(0);
  });

  it("has RLS enabled with a policy on every public table", async () => {
    // Guards the real failure mode: a future migration adds a table and
    // forgets the policy. This test fails the day that happens.
    const gaps = await admin.$queryRawUnsafe<{ relname: string }[]>(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname not like '_prisma%'
        and (
          c.relrowsecurity = false
          or (select count(*) from pg_policies p where p.tablename = c.relname) = 0
        )
    `);
    expect(gaps).toEqual([]);
  });

  it("removes every owned row when the auth user is deleted", async () => {
    // Regression guard. Prisma cannot model auth.users, so profiles.id had no
    // foreign key to it — deleting an account left profiles, missions,
    // sessions, and notes orphaned but still present, quietly breaking
    // account deletion (FR-A4). The FK added in the
    // 20260805155000_profiles_fk_auth_users migration is what closes it.
    const doomed = "33333333-3333-4333-8333-333333333333";
    await admin.$executeRawUnsafe(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
         email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
         'authenticated', $2, '', now(), now(), now())`,
      doomed,
      `${doomed}@test.local`,
    );
    await admin.$executeRawUnsafe(
      `insert into missions (id, user_id, topic, status, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, 'to be erased', 'active', now(), now())`,
      doomed,
    );

    await admin.$executeRawUnsafe(`delete from auth.users where id = $1::uuid`, doomed);

    const [{ count: profiles }] = await admin.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from profiles where id = $1::uuid`,
      doomed,
    );
    const [{ count: missions }] = await admin.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from missions where user_id = $1::uuid`,
      doomed,
    );
    expect(Number(profiles)).toBe(0);
    expect(Number(missions)).toBe(0);
  });
});
