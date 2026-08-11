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
const plugins: string[] = [];

async function seedUser(id: string, key: string): Promise<void> {
  await admin.$executeRawUnsafe(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at)
     values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', $2, '', now(), now(), now())`,
    id,
    `${id}@dispatch.test`,
  );
  const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'Dispatch suite', 'active', $2, now(), now())
     returning id`,
    id,
    key,
  );
  missions.set(id, rows[0]!.id);
}

/** A queued run, `agedSeconds` old, so ordering can be asserted deterministically. */
async function queue(
  userId: string,
  kind: string,
  agedSeconds = 0,
  status = "queued",
): Promise<string> {
  const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into agent_runs (id, user_id, mission_id, kind, status, input, created_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, '{}'::jsonb,
       now() - ($5::int || ' seconds')::interval)
     returning id`,
    userId,
    missions.get(userId),
    kind,
    status,
    BACKDATE_SECONDS + agedSeconds,
  );
  return rows[0]!.id;
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

  it("takes the oldest first, across users", async () => {
    // The anti-starvation rule: a user who queued while another mission was
    // running must not be overtaken by one who kept pressing the button.
    await queue(ALICE, "generate_lesson", 10);
    const older = await queue(BOB, "generate_lesson", 120);

    expect((await next())?.id).toBe(older);
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
