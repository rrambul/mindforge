import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * What teaching has cost (FR-T8), against real `llm_calls` rows.
 *
 * The ledger existed from M3 and nothing read it: every model call was recorded,
 * reconciled so a run's rows summed to its real bill, and then never asked a
 * question. Three things here can only be checked against Postgres:
 *
 * - **`numeric` is summed by the database, not by JavaScript.** `cost_usd` is
 *   `numeric(10, 6)` and the driver hands the aggregate over as a string. Adding
 *   a day of small calls as floats is precisely the money bug CLAUDE.md's "cost as
 *   numeric, never float" exists to prevent, and only a real sum shows it.
 * - **A null `cost_usd` is not a zero.** The `filter (where …)` clauses are what
 *   keep an unpriced call out of the total while still counting it, and a double
 *   would return whatever it was told.
 * - **RLS.** One learner's spend must not include another's, and the reader goes
 *   through `UserScopedDb` rather than trusting its own `where`.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;

interface SpendResponse {
  day: string;
  spentUsd: number;
  capUsd: number | null;
  remainingUsd: number | null;
  fraction: number | null;
  exhausted: boolean;
  unpricedCalls: number;
  atLeast: boolean;
}

/**
 * A priced call, `agoMinutes` in the past.
 *
 * Written straight into `llm_calls` because the alternative is running an agent,
 * which non-negotiable 8 forbids in a suite.
 */
async function call(user: TestUser, costUsd: string | null, agoMinutes = 1): Promise<void> {
  await db.$executeRawUnsafe(
    `insert into llm_calls (id, user_id, purpose, model, input_tokens, output_tokens, cost_usd,
       created_at)
     values (gen_random_uuid(), $1::uuid, 'teach_turn', 'claude-opus-5', 100, 50,
       $2::numeric, now() - ($3::int || ' minutes')::interval)`,
    user.id,
    costUsd,
    agoMinutes,
  );
}

function getSpend(user: TestUser) {
  return app.inject({ method: "GET", url: "/v1/teach/spend", headers: bearer(user) });
}

beforeAll(async () => {
  db = adminDb();
  app = await bootApp();
  [alice, bob] = await Promise.all([signUp(), signUp()]);
  // UTC so "today" is the same day the rows are written into, whatever the
  // machine running this thinks the time is. §5.2's rule is that the day is the
  // learner's; here that makes the assertion deterministic rather than merely
  // correct.
  await db.$executeRawUnsafe(`update profiles set timezone = 'UTC' where id = any($1::uuid[])`, [
    alice.id,
    bob.id,
  ]);
});

afterAll(async () => {
  await deleteUsers(db, [alice.id, bob.id]);
  await app.close();
  await db.$disconnect();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`delete from llm_calls where user_id = any($1::uuid[])`, [
    alice.id,
    bob.id,
  ]);
});

describe("GET /v1/teach/spend", () => {
  it("reports nothing spent on a day with no calls", async () => {
    const response = await getSpend(alice);

    expect(response.statusCode).toBe(200);
    // The one place zero is honest: no calls means nothing was spent, and the
    // denominator exists. Unlike a module with no lessons, nothing is unknown.
    expect(response.json<SpendResponse>()).toMatchObject({
      spentUsd: 0,
      exhausted: false,
      atLeast: false,
      unpricedCalls: 0,
    });
  });

  it("sums today's calls in the database, at the column's precision", async () => {
    // Six decimals each, chosen so a float sum drifts: 0.1 + 0.2 is the classic,
    // and `numeric` gets it exactly right where JavaScript does not.
    await call(alice, "0.100000");
    await call(alice, "0.200000");
    await call(alice, "1.234567");

    expect((await getSpend(alice)).json<SpendResponse>().spentUsd).toBe(1.534567);
  });

  it("counts an unpriced call without pretending it was free", async () => {
    // `cost_usd` is null when the model is not in the pricing table. Folding those
    // in as zero reports a run that cost real money as costing nothing.
    await call(alice, "2.000000");
    await call(alice, null);
    await call(alice, null);

    expect((await getSpend(alice)).json<SpendResponse>()).toMatchObject({
      spentUsd: 2,
      unpricedCalls: 2,
      // So the UI renders "at least $2.00" rather than a figure it cannot stand
      // behind.
      atLeast: true,
    });
  });

  it("ignores calls from before today", async () => {
    await call(alice, "5.000000", 60 * 48);

    expect((await getSpend(alice)).json<SpendResponse>().spentUsd).toBe(0);
  });

  it("reports the cap and what is left of it", async () => {
    await call(alice, "3.000000");
    const body = (await getSpend(alice)).json<SpendResponse>();

    // The default ceiling, from `TEACH_DAILY_BUDGET_USD`.
    expect(body.capUsd).toBe(15);
    expect(body.remainingUsd).toBe(12);
    expect(body.fraction).toBeCloseTo(0.2, 10);
  });

  it("keeps one learner's spend out of another's", async () => {
    // The reader goes through `UserScopedDb`, so RLS is the enforcement rather
    // than the `where` clause — this is what proves the policy is doing it.
    await call(bob, "9.000000");

    expect((await getSpend(alice)).json<SpendResponse>().spentUsd).toBe(0);
    expect((await getSpend(bob)).json<SpendResponse>().spentUsd).toBe(9);
  });

  it("needs a token", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/teach/spend" });
    expect(response.statusCode).toBe(401);
  });
});

describe("the budget as a ceiling on teaching", () => {
  it("refuses a run once the day's budget is spent, naming the cap", async () => {
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(
      `insert into missions (id, user_id, topic, status, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, 'Budget', 'active', now(), now()) returning id`,
      alice.id,
    );
    const missionId = rows[0]!.id;

    await call(alice, "15.000000");

    const response = await app.inject({
      method: "POST",
      url: `/v1/missions/${missionId}/teach`,
      headers: bearer(alice),
    });

    expect(response.statusCode).toBe(409);
    const problem = response.json<{ type: string; detail: string }>();
    // The slug, so the SPA can render the meter rather than a bare error — the
    // same branch `run-already-active` gets.
    expect(problem.type).toContain("teach-daily-budget-exhausted");
    // Naming the figure is the difference between a message and one that gets
    // pressed eleven more times.
    expect(problem.detail).toContain("$15.00");

    // And nothing was queued, so the mission is not left holding its
    // single-active-run slot for a run that will never happen.
    const queued = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from agent_runs where mission_id = $1::uuid`,
      missionId,
    );
    expect(Number(queued[0]!.count)).toBe(0);
  });
});
