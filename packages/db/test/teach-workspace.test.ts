import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";

/**
 * The M3 tables: isolation, the constraints that hold their shape, and one proof
 * that `schema.prisma` still describes the database.
 *
 * **Isolation** is CLAUDE.md's second non-negotiable, and these seven tables are
 * the ones where a leak would hurt most: `learner_memories` is what a model has
 * concluded about somebody, and `llm_calls` is their bill.
 *
 * **Constraints** carry more weight here than usual because two of them replace
 * mechanisms that do not exist. `agent_runs_one_active_per_mission_key` is what
 * §7.3 used to call "a BullMQ job key" — there is no queue, so this partial index
 * is the only thing standing between two concurrent runs and a corrupt sync. And
 * `llm_calls`' dedupe index is what stops a replayed message stream from billing
 * a user twice.
 *
 * **The Prisma round-trip at the bottom exists because `prisma migrate diff`
 * cannot run here.** The `profiles.id → auth.users.id` cross-schema foreign key
 * stops introspection dead, so nothing mechanical compares the hand-written SQL
 * with `schema.prisma`. A misnamed `@map` would typecheck, generate, and fail at
 * runtime on a query nobody had run yet. Reading and writing each model through
 * the client is the cheapest thing that would catch it.
 *
 * **Measured, not argued.** Commit `b4a7464` found that four of the M2 suite's
 * five insert proofs could not fail, so this one was checked the same way it was
 * fixed — by breaking the policies and counting:
 *
 *   `with check (true)` on all seven tables  → 7 failures, one per table
 *   `using (true)` on all seven tables       → 28 failures, four per table
 *
 * Every table discriminates on both halves. The numbers are here rather than in
 * a commit message because the next person to add a table will copy this file.
 */

const ADMIN_URL =
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Distinct from every other suite's pair: vitest.config.ts sets
// fileParallelism: false, but the delete-by-id sweep in beforeAll is per file and
// would otherwise wipe another suite's users mid-run.
const ALICE = "66666666-6666-4666-8666-666666666666";
const BOB = "77777777-7777-4777-8777-777777777777";

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

/** Each user's mission, so the foreign keys point somewhere that is theirs. */
const missionOf: Record<string, string> = {};

interface TableCase {
  readonly table: string;
  /** The column that differs between Alice's row and Bob's, so a leak reads as a value. */
  readonly identity: string;
  readonly insert: (userId: string, mark: string) => [string, unknown[]];
}

const CASES: readonly TableCase[] = [
  {
    table: "lessons",
    identity: "title",
    insert: (userId, mark) => [
      `insert into lessons (id, user_id, mission_id, seq, slug, title, storage_path,
         content_hash, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $2::uuid, $3::int, $4, $4, $5, 'sha-' || $4, now(), now())`,
      [userId, missionOf[userId], seqOf(mark), mark, `lessons/${mark}.html`],
    ],
  },
  {
    table: "reference_docs",
    identity: "title",
    insert: (userId, mark) => [
      `insert into reference_docs (id, user_id, mission_id, slug, title, storage_path,
         content_hash, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $2::uuid, $3, $3, $4, 'sha-' || $3, now(), now())`,
      [userId, missionOf[userId], mark, `reference/${mark}.html`],
    ],
  },
  {
    table: "learning_records",
    identity: "title",
    insert: (userId, mark) => [
      `insert into learning_records (id, user_id, mission_id, seq, title, what_learned,
         storage_path, content_hash)
       values (gen_random_uuid(), $1::uuid, $2::uuid, $3::int, $4, 'something', $5, 'sha-' || $4)`,
      [userId, missionOf[userId], seqOf(mark), mark, `learning-records/${mark}.md`],
    ],
  },
  {
    table: "workspace_files",
    identity: "content_hash",
    insert: (userId, mark) => [
      `insert into workspace_files (user_id, mission_id, path, content_hash, size_bytes)
       values ($1::uuid, $2::uuid, $3, $4, 12)`,
      [userId, missionOf[userId], `lessons/${mark}.html`, mark],
    ],
  },
  {
    table: "agent_runs",
    identity: "job_id",
    // Seeded as `succeeded` on purpose: `queued` and `running` are covered by the
    // one-active-run partial index, so a second row for the same mission would
    // collide before Postgres ever consulted the policy — which is precisely the
    // mistake commit b4a7464 fixed on the M2 tables.
    insert: (userId, mark) => [
      `insert into agent_runs (id, user_id, mission_id, kind, status, job_id)
       values (gen_random_uuid(), $1::uuid, $2::uuid, 'generate_lesson', 'succeeded', $3)`,
      [userId, missionOf[userId], mark],
    ],
  },
  {
    table: "llm_calls",
    identity: "purpose",
    insert: (userId, mark) => [
      `insert into llm_calls (id, user_id, purpose, model, input_tokens, output_tokens)
       values (gen_random_uuid(), $1::uuid, $2, 'claude-opus-5', 10, 5)`,
      [userId, mark],
    ],
  },
  {
    table: "learner_memories",
    identity: "summary",
    insert: (userId, mark) => [
      `insert into learner_memories (id, user_id, slug, kind, summary, storage_path,
         content_hash, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $2, 'teaching_preference', $2, $3, 'sha-' || $2,
         now(), now())`,
      [userId, mark, `memory/${userId}/${mark}.md`],
    ],
  },
];

/** `seq` is NOT NULL on two tables, so each mark needs a distinct number. */
function seqOf(mark: string): number {
  const digits = /(\d+)/u.exec(mark);
  return digits ? Number(digits[1]) : 1;
}

const MARKS: Record<string, string> = {
  lessons: "alice-1",
  reference_docs: "alice-ref",
  learning_records: "alice-1",
  workspace_files: "alice-hash",
  agent_runs: "alice-job",
  llm_calls: "alice-purpose",
  learner_memories: "alice-pref",
};

const BOB_MARKS: Record<string, string> = {
  lessons: "bob-2",
  reference_docs: "bob-ref",
  learning_records: "bob-2",
  workspace_files: "bob-hash",
  agent_runs: "bob-job",
  llm_calls: "bob-purpose",
  learner_memories: "bob-pref",
};

/**
 * A valid mark that collides with neither user's row, for the planted-insert proof.
 *
 * Separate from the two above precisely because reusing them is what made that
 * proof vacuous on the M2 tables: a value that cannot be cast, or that trips a
 * unique index, throws before the policy is ever asked. Every value here is
 * type-valid, and every `seq` and `slug` it produces is free.
 */
const PLANTED: Record<string, string> = {
  lessons: "planted-9",
  reference_docs: "planted-ref",
  learning_records: "planted-9",
  workspace_files: "planted-hash",
  agent_runs: "planted-job",
  llm_calls: "planted-purpose",
  learner_memories: "planted-pref",
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

async function seedMission(userId: string, key: string): Promise<string> {
  const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2, 'active', $2, now(), now()) returning id`,
    userId,
    key,
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  await seedUser(ALICE);
  await seedUser(BOB);

  missionOf[ALICE] = await seedMission(ALICE, "alice-mission");
  missionOf[BOB] = await seedMission(BOB, "bob-mission");

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
    const stolen = await asUser<unknown[]>(
      ALICE,
      `select ${identity} as v from ${table} where user_id = $1::uuid`,
      BOB,
    );
    expect(stolen).toHaveLength(0);
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
    const bobAfter = await asUser<{ v: string }[]>(BOB, `select ${identity} as v from ${table}`);
    expect(bobAfter.map((r) => r.v)).toEqual([BOB_MARKS[table]]);
  });

  it("refuses to delete another user's data", async () => {
    await asUser(ALICE, `delete from ${table} where user_id = $1::uuid`, BOB);
    const bobAfter = await asUser<unknown[]>(BOB, `select 1 from ${table}`);
    expect(bobAfter).toHaveLength(1);
  });

  it("refuses to insert a row owned by someone else", async () => {
    // The WITH CHECK half. Without it Alice can write into Bob's account even
    // though she cannot read it back — worse than a read leak, because it corrupts
    // data nobody is looking at.
    //
    // The assertion names the error rather than accepting any throw: only a policy
    // violation says "row-level security", and a planted value that failed to cast
    // or tripped a unique index would satisfy a bare `rejects.toThrow()` without
    // Postgres consulting the policy at all.
    const [sql, params] = CASES.find((c) => c.table === table)!.insert(BOB, PLANTED[table]!);
    await expect(asUser(ALICE, sql, ...params)).rejects.toThrow(/row-level security/iu);
  });
});

describe("agent_runs: one active run per mission", () => {
  async function run(userId: string, status: string, mission = missionOf[userId]) {
    return admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into agent_runs (id, user_id, mission_id, kind, status)
       values (gen_random_uuid(), $1::uuid, $2::uuid, 'generate_lesson', $3) returning id`,
      userId,
      mission,
      status,
    );
  }

  it("refuses a second queued run against the same mission", async () => {
    // This is the whole concurrency control. §7.3 used to say "enforced with a
    // BullMQ job key" and there is no queue — two runs materialising and syncing
    // one workspace is the fastest route to losing a lesson.
    await run(ALICE, "queued");
    await expect(run(ALICE, "queued")).rejects.toThrow();
  });

  it("refuses a queued run while another is already running", async () => {
    // The index covers both states, not just the one. A `where status = 'queued'`
    // would leave a running mission claimable, which is the same corruption with
    // an extra step.
    const other = await seedMission(ALICE, "second-mission");
    await admin.$executeRawUnsafe(
      `insert into agent_runs (id, user_id, mission_id, kind, status)
       values (gen_random_uuid(), $1::uuid, $2::uuid, 'generate_lesson', 'running')`,
      ALICE,
      other,
    );
    await expect(run(ALICE, "queued", other)).rejects.toThrow();
  });

  it("lets a finished mission be taught again", async () => {
    // The index is partial for exactly this reason: runs accumulate, and a
    // mission taught once must be teachable a second time.
    const third = await seedMission(ALICE, "third-mission");
    await run(ALICE, "succeeded", third);
    await run(ALICE, "failed", third);
    await expect(run(ALICE, "queued", third)).resolves.toHaveLength(1);
  });

  it("lets two different missions run at once", async () => {
    const fourth = await seedMission(ALICE, "fourth-mission");
    await expect(run(ALICE, "running", fourth)).resolves.toHaveLength(1);
  });

  it("treats succeeded_with_conflicts as finished, not as active", async () => {
    // A conflicted run did its work and kept both versions. Counting it as active
    // would wedge the mission until somebody resolved a conflict, which turns an
    // honest outcome into a blocker.
    const fifth = await seedMission(ALICE, "fifth-mission");
    await run(ALICE, "succeeded_with_conflicts", fifth);
    await expect(run(ALICE, "queued", fifth)).resolves.toHaveLength(1);
  });

  it("refuses a status the reaper and the UI do not know", async () => {
    await expect(run(ALICE, "probably_fine")).rejects.toThrow();
  });
});

describe("llm_calls", () => {
  let runId: string;

  beforeAll(async () => {
    const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into agent_runs (id, user_id, mission_id, kind, status)
       values (gen_random_uuid(), $1::uuid, $2::uuid, 'generate_lesson', 'succeeded') returning id`,
      ALICE,
      missionOf[ALICE],
    );
    runId = rows[0]!.id;
  });

  async function call(key: string | null, purpose = "teach_turn") {
    return admin.$executeRawUnsafe(
      `insert into llm_calls (id, user_id, agent_run_id, purpose, model, call_key)
       values (gen_random_uuid(), $1::uuid, $2::uuid, $3, 'claude-opus-5', $4)`,
      ALICE,
      runId,
      purpose,
      key,
    );
  }

  it("refuses the same call twice within a run", async () => {
    // Parallel tool calls emit several assistant messages sharing one id and one
    // cumulative usage figure. Writing a row each would multiply the reported cost
    // by the parallelism factor — silently, and upward.
    await call("req_abc");
    await expect(call("req_abc")).rejects.toThrow();
  });

  it("lets two runs report the same call key", async () => {
    const other = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into agent_runs (id, user_id, mission_id, kind, status)
       values (gen_random_uuid(), $1::uuid, null, 'weekly_digest', 'succeeded') returning id`,
      ALICE,
    );
    await expect(
      admin.$executeRawUnsafe(
        `insert into llm_calls (id, user_id, agent_run_id, purpose, model, call_key)
         values (gen_random_uuid(), $1::uuid, $2::uuid, 'teach_turn', 'claude-opus-5', 'req_abc')`,
        ALICE,
        other[0]!.id,
      ),
    ).resolves.toBeDefined();
  });

  it("allows many rows with no call key, for calls that do not come from a run", async () => {
    // The index is partial. A non-agent call site (§8.5's URL metadata) has no
    // message id to dedupe on, and must not be forced to invent one.
    await call(null, "url_metadata");
    await expect(call(null, "url_metadata")).resolves.toBeDefined();
  });

  it("keeps the cost when the run it belongs to is deleted", async () => {
    // Set null, not cascade. The cost meter and the monthly cap are the two things
    // that must survive a tidy-up — a bill that disappears with its job is a bill
    // that understates.
    const doomed = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into agent_runs (id, user_id, mission_id, kind, status)
       values (gen_random_uuid(), $1::uuid, null, 'generate_plan', 'succeeded') returning id`,
      ALICE,
    );
    await admin.$executeRawUnsafe(
      `insert into llm_calls (id, user_id, agent_run_id, purpose, model, cost_usd)
       values (gen_random_uuid(), $1::uuid, $2::uuid, 'doomed_run', 'claude-opus-5', 0.5)`,
      ALICE,
      doomed[0]!.id,
    );
    await admin.$executeRawUnsafe(`delete from agent_runs where id = $1::uuid`, doomed[0]!.id);

    const rows = await asUser<{ cost_usd: string; agent_run_id: string | null }[]>(
      ALICE,
      `select cost_usd, agent_run_id from llm_calls where purpose = 'doomed_run'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agent_run_id).toBeNull();
  });

  it("stores an unknown price as null rather than as zero", async () => {
    // Non-negotiable 10. The SDK reports whatever model id it used, and one absent
    // from the pricing table has no price — which is not the same fact as costing
    // nothing, and would understate the meter if it were written as 0.
    await admin.$executeRawUnsafe(
      `insert into llm_calls (id, user_id, purpose, model)
       values (gen_random_uuid(), $1::uuid, 'unpriced', 'claude-from-the-future')`,
      ALICE,
    );
    const rows = await asUser<{ cost_usd: string | null }[]>(
      ALICE,
      `select cost_usd from llm_calls where purpose = 'unpriced'`,
    );
    expect(rows[0]!.cost_usd).toBeNull();
  });
});

describe("workspace_key", () => {
  it("lets two users hold the same workspace key", async () => {
    // It was globally unique until M3. The Storage path is
    // workspaces/<user_id>/<key>/, so the key only has to be unique within a user
    // — and a global unique tells the second person to want `rust` that somebody
    // else already has a mission by that name.
    await admin.$executeRawUnsafe(
      `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, 'shared', 'active', 'rust', now(), now())`,
      ALICE,
    );
    await expect(
      admin.$executeRawUnsafe(
        `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
         values (gen_random_uuid(), $1::uuid, 'shared', 'active', 'rust', now(), now())`,
        BOB,
      ),
    ).resolves.toBeDefined();
  });

  it("still refuses two missions of one user sharing a key", async () => {
    // The half that must survive the widening: two missions on one prefix would
    // read and write each other's lessons.
    await expect(
      admin.$executeRawUnsafe(
        `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
         values (gen_random_uuid(), $1::uuid, 'again', 'active', 'rust', now(), now())`,
        ALICE,
      ),
    ).rejects.toThrow();
  });

  it("lets many missions have no workspace key at all", async () => {
    // Null until first materialisation. Postgres treats nulls as distinct in a
    // unique index, which is what makes "not yet taught" a legal state for every
    // mission at once rather than for one of them.
    for (const topic of ["untaught-a", "untaught-b"]) {
      await admin.$executeRawUnsafe(
        `insert into missions (id, user_id, topic, status, created_at, updated_at)
         values (gen_random_uuid(), $1::uuid, $2, 'active', now(), now())`,
        ALICE,
        topic,
      );
    }
    const rows = await asUser<{ n: bigint }[]>(
      ALICE,
      `select count(*) as n from missions where workspace_key is null`,
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });
});

describe("shape of the indexed files", () => {
  it("refuses two lessons at the same sequence in one mission", async () => {
    // The reindexer catches this and warns rather than failing the run, but the
    // constraint is what makes "catches it" true — a `.conflict-` copy landing in
    // lessons/ parses to a number that already exists.
    await expect(
      admin.$executeRawUnsafe(
        `insert into lessons (id, user_id, mission_id, seq, slug, title, storage_path,
           content_hash, created_at, updated_at)
         values (gen_random_uuid(), $1::uuid, $2::uuid, 1, 'dupe', 'dupe',
           'lessons/0001-dupe.html', 'sha', now(), now())`,
        ALICE,
        missionOf[ALICE],
      ),
    ).rejects.toThrow();
  });

  it("keeps a learning record when the lesson it came from is deleted", async () => {
    // Set null, not cascade. The format calls records append-only: deleting the
    // source of an insight must not delete the insight.
    const lesson = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into lessons (id, user_id, mission_id, seq, slug, title, storage_path,
         content_hash, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $2::uuid, 50, 'doomed', 'doomed',
         'lessons/0050-doomed.html', 'sha', now(), now()) returning id`,
      ALICE,
      missionOf[ALICE],
    );
    await admin.$executeRawUnsafe(
      `insert into learning_records (id, user_id, mission_id, seq, title, lesson_id,
         what_learned, storage_path, content_hash)
       values (gen_random_uuid(), $1::uuid, $2::uuid, 50, 'orphan', $3::uuid, 'a thing',
         'learning-records/0050-orphan.md', 'sha')`,
      ALICE,
      missionOf[ALICE],
      lesson[0]!.id,
    );
    await admin.$executeRawUnsafe(`delete from lessons where id = $1::uuid`, lesson[0]!.id);

    const rows = await asUser<{ lesson_id: string | null }[]>(
      ALICE,
      `select lesson_id from learning_records where title = 'orphan'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lesson_id).toBeNull();
  });

  it("refuses a lesson outcome the scorer cannot weight", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `insert into lessons (id, user_id, mission_id, seq, slug, title, storage_path,
           content_hash, outcome, created_at, updated_at)
         values (gen_random_uuid(), $1::uuid, $2::uuid, 60, 'x', 'x', 'lessons/0060-x.html',
           'sha', 'brilliant', now(), now())`,
        ALICE,
        missionOf[ALICE],
      ),
    ).rejects.toThrow();
  });

  it("refuses a learner memory kind nothing knows how to file", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `insert into learner_memories (id, user_id, slug, kind, summary, storage_path,
           content_hash, created_at, updated_at)
         values (gen_random_uuid(), $1::uuid, 'odd', 'vibes', 'x', 'memory/x.md', 'sha',
           now(), now())`,
        ALICE,
      ),
    ).rejects.toThrow();
  });

  it("keeps a superseded memory rather than replacing it", async () => {
    // §7.6: supersede, never mutate. That a stated preference changed is itself
    // the information — overwriting it is how a model accumulates conclusions
    // about somebody that nobody agreed to.
    const first = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into learner_memories (id, user_id, slug, kind, summary, storage_path,
         content_hash, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, 'analogies', 'teaching_preference',
         'likes analogies', 'memory/analogies.md', 'sha1', now(), now()) returning id`,
      ALICE,
    );
    const second = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into learner_memories (id, user_id, slug, kind, summary, storage_path,
         content_hash, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, 'analogies-2', 'teaching_preference',
         'actually dislikes analogies', 'memory/analogies-2.md', 'sha2', now(), now()) returning id`,
      ALICE,
    );
    await admin.$executeRawUnsafe(
      `update learner_memories set superseded_by = $2::uuid where id = $1::uuid`,
      first[0]!.id,
      second[0]!.id,
    );

    const rows = await asUser<{ summary: string }[]>(
      ALICE,
      `select summary from learner_memories where slug like 'analogies%' order by slug`,
    );
    expect(rows.map((r) => r.summary)).toEqual(["likes analogies", "actually dislikes analogies"]);
  });

  it("takes the whole workspace index with the mission", async () => {
    // Cascade here rather than set-null: a lesson with no mission is a file in a
    // Storage prefix nothing points at, and every screen that lists lessons is
    // scoped by mission.
    const doomed = await seedMission(ALICE, "doomed-mission");
    await admin.$executeRawUnsafe(
      `insert into workspace_files (user_id, mission_id, path, content_hash, size_bytes)
       values ($1::uuid, $2::uuid, 'MISSION.md', 'sha', 10)`,
      ALICE,
      doomed,
    );
    await admin.$executeRawUnsafe(`delete from missions where id = $1::uuid`, doomed);

    const left = await asUser<unknown[]>(
      ALICE,
      `select path from workspace_files where mission_id = $1::uuid`,
      doomed,
    );
    expect(left).toHaveLength(0);
  });
});

describe("schema.prisma still describes the database", () => {
  /**
   * `prisma migrate diff` cannot run in this repo — introspection stops at the
   * `profiles.id → auth.users.id` cross-schema foreign key — so nothing
   * mechanical compares the hand-written SQL with the model file. A wrong `@map`
   * typechecks, generates, and fails at runtime on the first query that touches
   * it, which in M3's case would be during an agent run.
   *
   * Reading every M3 model through the generated client is the cheapest thing
   * that catches it. It is deliberately a read of the rows this suite already
   * seeded rather than a fresh write: a select names every column.
   */
  it("reads every M3 model through the generated client", async () => {
    const [lessons, refs, records, files, runs, calls, memories] = await Promise.all([
      admin.lesson.findMany({ where: { userId: ALICE } }),
      admin.referenceDoc.findMany({ where: { userId: ALICE } }),
      admin.learningRecord.findMany({ where: { userId: ALICE } }),
      admin.workspaceFile.findMany({ where: { userId: ALICE } }),
      admin.agentRun.findMany({ where: { userId: ALICE } }),
      admin.llmCall.findMany({ where: { userId: ALICE } }),
      admin.learnerMemory.findMany({ where: { userId: ALICE } }),
    ]);

    expect(lessons.length).toBeGreaterThan(0);
    expect(refs.length).toBeGreaterThan(0);
    expect(records.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(0);
    expect(runs.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(memories.length).toBeGreaterThan(0);
  });

  it("maps every column of the widest model, including the ones nothing writes yet", async () => {
    // `completed_at` and `outcome` are M4's, and `heartbeat_at` is written by a
    // loop that does not exist until the worker pipeline lands. A model whose
    // unwritten columns are misnamed looks perfectly healthy until the milestone
    // that needs them.
    const lesson = await admin.lesson.findFirst({ where: { userId: ALICE } });
    expect(lesson).toMatchObject({
      seq: expect.any(Number),
      slug: expect.any(String),
      title: expect.any(String),
      storagePath: expect.any(String),
      contentHash: expect.any(String),
      completedAt: null,
      outcome: null,
    });

    const run = await admin.agentRun.findFirst({ where: { userId: ALICE } });
    expect(run).toMatchObject({
      kind: expect.any(String),
      status: expect.any(String),
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    });
  });

  it("writes and reads back through the client, so @map holds in both directions", async () => {
    // A findMany proves the column names resolve for reads. An insert proves it
    // for writes, which is the direction the reindexer uses.
    const created = await admin.learnerMemory.create({
      data: {
        userId: ALICE,
        slug: "written-by-prisma",
        kind: "learning_pattern",
        summary: "retains by building",
        storagePath: `memory/${ALICE}/written-by-prisma.md`,
        contentHash: "sha-prisma",
        writtenBy: "user",
      },
    });

    expect(created.writtenBy).toBe("user");
    expect(created.confirmedAt).toBeNull();
    expect(created.supersededById).toBeNull();
  });
});
