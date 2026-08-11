import { createPrismaClient } from "@mindforge/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { RecordedCall } from "../src/modules/teach/application/llm-call.port.js";
import { PrismaLlmCallSink } from "../src/modules/teach/infrastructure/prisma-llm-call.sink.js";

/**
 * The cost ledger, against real rows (non-negotiable 9).
 *
 * The claim this adapter makes is that a replayed message stream cannot bill a
 * learner twice, and it makes it entirely out of database behaviour: a partial
 * unique index on `(agent_run_id, call_key)` plus `skipDuplicates`. A double
 * would be written to agree with that and would agree with it whether or not the
 * index existed — which is the failure worth catching, because the symptom is a
 * number that is simply too high and looks like usage.
 *
 * `costUsd` null-versus-zero is the other one. A model with no price is unknown,
 * and a zero understates the meter while looking like a measurement.
 */

const ADMIN_URL =
  process.env["DIRECT_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const USER = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";

const admin = createPrismaClient(ADMIN_URL);
const sink = new PrismaLlmCallSink(admin);

let runId: string;

function call(over: Partial<RecordedCall> = {}): RecordedCall {
  return {
    purpose: "teach_turn",
    model: "claude-opus-5",
    key: "turn-1",
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0.0042,
    ...over,
  };
}

function rows(): Promise<{ call_key: string; cost_usd: string | null; model: string }[]> {
  return admin.$queryRawUnsafe(
    `select call_key, cost_usd::text as cost_usd, model from llm_calls
      where agent_run_id = $1::uuid order by call_key`,
    runId,
  );
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = $1::uuid`, USER);
  await admin.$executeRawUnsafe(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at)
     values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', $2, '', now(), now(), now())`,
    USER,
    `${USER}@sink.test`,
  );
});

afterAll(async () => {
  await admin.$executeRawUnsafe(`delete from auth.users where id = $1::uuid`, USER);
  await admin.$disconnect();
});

beforeEach(async () => {
  await admin.$executeRawUnsafe(`delete from agent_runs where user_id = $1::uuid`, USER);
  const created = await admin.$queryRawUnsafe<{ id: string }[]>(
    `insert into agent_runs (id, user_id, kind, status, input, created_at)
     values (gen_random_uuid(), $1::uuid, 'generate_lesson', 'running', '{}'::jsonb, now())
     returning id`,
    USER,
  );
  runId = created[0]!.id;
});

describe("recording what a run cost", () => {
  it("writes a row per call", async () => {
    await sink.record(USER, runId, [call(), call({ key: "turn-2", costUsd: 0.01 })]);

    expect((await rows()).map((row) => row.call_key)).toEqual(["turn-1", "turn-2"]);
  });

  it("does nothing at all for an empty stream", async () => {
    // Guarded before the query rather than after: `createMany` with no rows is a
    // round trip to say nothing.
    await sink.record(USER, runId, []);

    expect(await rows()).toEqual([]);
  });

  it("cannot bill the same turn twice", async () => {
    // The whole point. A retried run or a resumed session replays the stream, and
    // the index is what makes that free — `skipDuplicates` alone would not.
    await sink.record(USER, runId, [call()]);
    await sink.record(USER, runId, [call(), call({ key: "turn-2" })]);

    expect((await rows()).map((row) => row.call_key)).toEqual(["turn-1", "turn-2"]);
  });

  it("keeps a replay from revising a row that was already right", async () => {
    // `skipDuplicates` and not an upsert: an upsert would rewrite usage that is
    // already correct, which is the same number at best and a double-counted turn
    // at worst.
    await sink.record(USER, runId, [call({ costUsd: 0.0042 })]);
    await sink.record(USER, runId, [call({ costUsd: 9.9999 })]);

    // Compared as a number: the column is `numeric` and reads back at its own
    // scale, so a string comparison would be asserting the column's precision.
    expect(Number((await rows())[0]?.cost_usd)).toBe(0.0042);
  });

  it("stores an unpriced model as null, never as zero", async () => {
    // A zero here quietly understates the cost meter and the monthly cap while
    // looking exactly like a measurement (non-negotiable 10).
    await sink.record(USER, runId, [call({ key: "unpriced", costUsd: null })]);

    expect((await rows())[0]?.cost_usd).toBeNull();
  });

  it("keeps the same key apart across two runs", async () => {
    // The index is per run. `teach_turn`'s keys restart at 1 every time, so a
    // global unique would silently drop every turn of every run after the first.
    const first = runId;
    await sink.record(USER, first, [call()]);

    const other = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into agent_runs (id, user_id, kind, status, input, created_at)
       values (gen_random_uuid(), $1::uuid, 'generate_lesson', 'running', '{}'::jsonb, now())
       returning id`,
      USER,
    );
    runId = other[0]!.id;
    await sink.record(USER, runId, [call()]);

    expect(await rows()).toHaveLength(1);
    runId = first;
    expect(await rows()).toHaveLength(1);
  });
});
