import { createPrismaClient } from "@mindforge/db";
import { rm } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaDispatchGateway } from "../src/modules/teach/infrastructure/prisma-dispatch.gateway.js";

/**
 * What the dispatcher picks up, against real rows.
 *
 * This query is the whole of the worker's scheduling policy and every clause in
 * it is load-bearing in a way a double cannot check: the kind filter decides
 * which agent runs, the `workspace_key is not null` join decides whether a run is
 * runnable at all, and the ordering decides whether one impatient user starves
 * everyone else. A mock would return whatever it was told, and the failure mode
 * for all three is a run that sits queued forever holding its mission's
 * single-active-run slot.
 *
 * `agent-sdk.gateway.ts` is the one adapter in this directory with no test here
 * and cannot have one: it calls the Anthropic Agent SDK, and non-negotiable 8
 * forbids live API calls in the suites. See `vitest.integration.config.ts`.
 */

const ADMIN_URL =
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Distinct from every other suite's, because `fileParallelism: false` is per file
// and the sweep below would otherwise take another suite's rows mid-run.
const ALICE = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const BOB = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";

const admin = createPrismaClient(ADMIN_URL);
const gateway = new PrismaDispatchGateway(admin);

/**
 * A decade, so this suite's runs are always the oldest thing in the table.
 *
 * `nextQueued` is deliberately cross-user — the dispatcher's job is to find work
 * wherever it is — so per-user isolation, which every other suite here relies on,
 * protects nothing. The E2E suite signs up throwaway accounts, queues real runs on
 * them and never deletes them, so the table genuinely contains other people's
 * queued work whenever this runs after Playwright.
 *
 * Two defences, because either alone is a flake: everything here is backdated so
 * the ordering assertions are about *these* rows, and `next()` below discards a
 * run belonging to anyone else so the negative assertions cannot be satisfied by a
 * stranger's.
 */
const BACKDATE_SECONDS = 10 * 365 * 24 * 60 * 60;

/** What the dispatcher would pick up, if it belongs to this suite. */
async function next(): Promise<Awaited<ReturnType<typeof gateway.nextQueued>>> {
  const run = await gateway.nextQueued();
  return run !== null && (run.userId === ALICE || run.userId === BOB) ? run : null;
}

const missions = new Map<string, string>();
/**
 * A second mission per user, because `agent_runs_one_active_per_mission_key`
 * allows only one queued or running run per mission.
 *
 * That constraint is the reason the fairness bug existed at all: it bounds
 * concurrency per *mission*, so a learner with several missions can legitimately
 * have several runs waiting, and the queue is the only thing deciding between
 * them and everybody else's.
 */
const secondMissions = new Map<string, string>();
const plugins: string[] = [];

async function createMission(userId: string, key: string): Promise<string> {
  const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'Dispatch suite', 'active', $2, now(), now())
     returning id`,
    userId,
    key,
  );
  return rows[0]!.id;
}

async function seedUser(id: string, key: string): Promise<void> {
  await admin.$executeRawUnsafe(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at)
     values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', $2, '', now(), now(), now())`,
    id,
    `${id}@dispatch.test`,
  );
  missions.set(id, await createMission(id, key));
  secondMissions.set(id, await createMission(id, `${key}-2`));
}

/** A queued run, `agedSeconds` old, so ordering can be asserted deterministically. */
async function queue(
  userId: string,
  kind: string,
  agedSeconds = 0,
  status = "queued",
  missionId: string | undefined = missions.get(userId),
): Promise<string> {
  const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into agent_runs (id, user_id, mission_id, kind, status, input, created_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, '{}'::jsonb,
       now() - ($5::int || ' seconds')::interval)
     returning id`,
    userId,
    missionId,
    kind,
    status,
    BACKDATE_SECONDS + agedSeconds,
  );
  return rows[0]!.id;
}

/**
 * A run this user has already been served, `agedSeconds` ago.
 *
 * Finished rather than running, so it cannot be mistaken for work still in flight
 * — what the ordering reads is `started_at`, and the point of the row is only that
 * the worker has spent time on this person recently.
 */
async function served(userId: string, agedSeconds: number): Promise<void> {
  await admin.$executeRawUnsafe(
    `insert into agent_runs (id, user_id, mission_id, kind, status, input, created_at,
       started_at, finished_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, 'generate_lesson', 'succeeded', '{}'::jsonb,
       now() - ($3::int || ' seconds')::interval,
       now() - ($3::int || ' seconds')::interval,
       now() - ($3::int || ' seconds')::interval)`,
    userId,
    missions.get(userId),
    agedSeconds,
  );
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  await seedUser(ALICE, "dispatch-alice");
  await seedUser(BOB, "dispatch-bob");
});

afterAll(async () => {
  await Promise.all(plugins.map((path) => rm(path, { recursive: true, force: true })));
  await admin.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [ALICE, BOB]);
  await admin.$disconnect();
});

beforeEach(async () => {
  await admin.$executeRawUnsafe(`delete from agent_runs where user_id = any($1::uuid[])`, [
    ALICE,
    BOB,
  ]);
});

describe("what the dispatcher picks up", () => {
  it("finds nothing when nothing is queued", async () => {
    expect(await next()).toBeNull();
  });

  it("returns a queued lesson run with everything the run needs", async () => {
    const id = await queue(ALICE, "generate_lesson");

    expect(await next()).toEqual({
      id,
      userId: ALICE,
      missionId: missions.get(ALICE),
      kind: "generate_lesson",
      workspaceKey: "dispatch-alice",
      // Carried rather than looked up later: every "day" derives from it, and a
      // learning record resolved server-local lands on the wrong one.
      timezone: expect.any(String) as string,
    });
  });

  it("picks up a curriculum run too", async () => {
    // It did not, until M4's gap closed: the filter named `generate_lesson` alone,
    // so a curriculum run sat queued forever holding the mission's active slot.
    await queue(ALICE, "generate_curriculum");

    expect((await next())?.kind).toBe("generate_curriculum");
  });

  it("ignores a kind this worker cannot run", async () => {
    // Claiming one would hold the single-active-run slot while nothing happened.
    await queue(ALICE, "sync_workspace");

    expect(await next()).toBeNull();
  });

  it("ignores a run that is not queued", async () => {
    await queue(ALICE, "generate_lesson", 0, "running");

    expect(await next()).toBeNull();
  });

  it("skips a mission that has never been materialised", async () => {
    // No prefix to sync against. The run waits for the key rather than failing.
    await admin.$executeRawUnsafe(
      `update missions set workspace_key = null where id = $1::uuid`,
      missions.get(BOB),
    );
    await queue(BOB, "generate_lesson");

    expect(await next()).toBeNull();

    await admin.$executeRawUnsafe(
      `update missions set workspace_key = 'dispatch-bob' where id = $1::uuid`,
      missions.get(BOB),
    );
  });

  it("takes the oldest first between users who have never been served", async () => {
    // Neither has a `started_at` anywhere, so the round-robin key ties at the
    // epoch and the queue order decides — which is what makes the fairness rule an
    // addition to oldest-first rather than a replacement for it.
    await queue(ALICE, "generate_lesson", 10);
    const older = await queue(BOB, "generate_lesson", 120);

    expect((await next())?.id).toBe(older);
  });
});

/**
 * Fairness between learners, which is the whole reason this query is not one line.
 *
 * The worker runs a single agent at a time and a run takes about eight minutes,
 * while the single-active-run index is per *mission*. Under plain oldest-first,
 * one learner pressing the button on six missions owned the worker for three
 * quarters of an hour and everybody else waited behind all six — with nothing on
 * any screen to say why. These are the cases that could only be asserted against
 * real rows, because the ordering is entirely in SQL.
 */
describe("fairness between learners", () => {
  it("serves the learner who was served longest ago", async () => {
    // Alice queued first and has just had a run; Bob queued later and has been
    // waiting since yesterday. Oldest-first would take Alice's, which is exactly
    // the starvation this replaced.
    await served(ALICE, 60);
    await served(BOB, 24 * 60 * 60);

    const alices = await queue(ALICE, "generate_lesson", 300);
    const bobs = await queue(BOB, "generate_lesson", 10);

    expect((await next())?.id).toBe(bobs);
    expect((await next())?.id).not.toBe(alices);
  });

  it("puts a learner with no run at all in front of one with a backlog", async () => {
    // A first mission must not queue behind whatever the incumbent has lined up.
    // `to_timestamp(0)` in the ordering is what buys this.
    await served(ALICE, 30);
    await queue(ALICE, "generate_lesson", 9_000);
    const first = await queue(BOB, "generate_lesson", 1);

    expect((await next())?.id).toBe(first);
  });

  it("keeps one learner's own runs in the order they queued them", async () => {
    // Round-robin decides between people; within a person it is still a queue.
    // Two missions, because `agent_runs_one_active_per_mission_key` allows only one
    // waiting run per mission — which is also the reason a single learner can hold
    // several slots at once and why this ordering had to change.
    await served(ALICE, 60);
    const earlier = await queue(ALICE, "generate_lesson", 600);
    await queue(ALICE, "generate_lesson", 60, "queued", secondMissions.get(ALICE));

    expect((await next())?.id).toBe(earlier);
  });

  it("ranks on runs that actually started, not on ones still waiting", async () => {
    // Alice queued *later* than Bob, so oldest-first would take Bob's. She has
    // never been served, though, and Bob was served ten days ago — so she goes
    // first, and the assertion discriminates between the two orderings rather than
    // passing under both.
    //
    // The `started_at is not null` filter is what this pins down: counting queued
    // rows would push a learner to the back of the line for their own waiting work,
    // which is the opposite of the intent.
    const bobs = await queue(BOB, "generate_lesson", 5_000);
    const alices = await queue(ALICE, "generate_lesson", 10);
    await served(BOB, 10 * 24 * 60 * 60);

    const first = await next();
    expect(first?.id).toBe(alices);
    expect(first?.id).not.toBe(bobs);
  });
});

describe("the plugin a run loads", () => {
  it("writes the teach skill for a lesson run", async () => {
    const plugin = await gateway.writePlugin("run-lesson", "generate_lesson");
    plugins.push(plugin.path);

    expect(plugin.skillRef).toBe("mindforge-teach:teach");
  });

  it("writes the curriculum skill for a curriculum run", async () => {
    // Exactly one, never both: a teach run able to reach for `curriculum` would
    // rewrite the plan it is working through, and a curriculum run able to reach
    // for `teach` would generate the whole module at the moment it knew least.
    const plugin = await gateway.writePlugin("run-curriculum", "generate_curriculum");
    plugins.push(plugin.path);

    expect(plugin.skillRef).toBe("mindforge-curriculum:curriculum");
  });

  it("gives each run its own directory", async () => {
    const first = await gateway.writePlugin("run-a", "generate_lesson");
    const second = await gateway.writePlugin("run-a", "generate_lesson");
    plugins.push(first.path, second.path);

    // Per run rather than per process: the tree is deleted afterwards, and a
    // shared path would be shared mutable state between concurrent runs.
    expect(first.path).not.toBe(second.path);
  });
});
