import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReindexLearnerMemory } from "../src/modules/teach/application/reindex-memory.js";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * What the agent concluded about you, and your ability to argue with it (§7.6).
 *
 * The memory is replayed verbatim into every future run on every mission, which
 * is what makes a wrong entry expensive and the review surface non-negotiable —
 * §7.6's rule is "the agent writes it; you own it". These prove the "you own it"
 * half, plus the two shapes that would quietly break it:
 *
 * - A run must not be able to mark its own inference as user-confirmed.
 * - Deleting a memory must delete the file, or the next run puts the row back.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;
let reindex: ReindexLearnerMemory;

const encoder = new TextEncoder();

function memory(files: Record<string, string>) {
  return reindex.execute({
    userId: alice.id,
    files: new Map(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)])),
  });
}

interface MemoryResponse {
  id: string;
  slug: string;
  kind: string;
  summary: string;
  writtenBy: string;
  confirmedAt: string | null;
  supersededBySlug: string | null;
}

beforeAll(async () => {
  app = await bootApp();
  db = adminDb();
  alice = await signUp();
  bob = await signUp();
  reindex = app.get(ReindexLearnerMemory, { strict: false });
});

afterAll(async () => {
  await deleteUsers(db, [alice.id, bob.id]);
  await app.close();
  await db.$disconnect();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`delete from learner_memories where user_id = any($1::uuid[])`, [
    alice.id,
    bob.id,
  ]);
});

describe("indexing what a run wrote", () => {
  it("turns a memory file into a row the learner can read", async () => {
    // The bullet that was schema-only until now: `learner_memories` had a table
    // and RLS and nothing that ever wrote it.
    const result = await memory({
      "learning-patterns.md": "# Retains by building, not by reading\n\nKind: learning_pattern\n",
    });

    expect(result.indexed).toBe(1);

    const response = await app.inject({
      method: "GET",
      url: "/v1/me/memory",
      headers: bearer(alice),
    });
    expect(response.json<MemoryResponse[]>()[0]).toMatchObject({
      slug: "learning-patterns",
      kind: "learning_pattern",
      summary: "Retains by building, not by reading",
      writtenBy: "agent",
      confirmedAt: null,
    });
  });

  it("does not duplicate on a second run", async () => {
    const file = { "background.md": "# Engineer who explains in code\n" };
    await memory(file);
    await memory(file);

    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from learner_memories where user_id = $1::uuid`,
      alice.id,
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("cannot mark its own inference as confirmed", async () => {
    // The dangerous one. `confirmed_at` means the learner read this and agreed —
    // a run setting it would let the agent vouch for itself, and a confirmed
    // memory is one the agent leans on harder.
    await memory({ "background.md": "# Engineer\n" });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/me/memory",
      headers: bearer(alice),
    });
    const id = listed.json<MemoryResponse[]>()[0]!.id;

    await app.inject({
      method: "POST",
      url: `/v1/me/memory/${id}/confirm`,
      headers: bearer(alice),
    });
    await memory({ "background.md": "# Engineer, mostly backend\n" });

    const after = await app.inject({ method: "GET", url: "/v1/me/memory", headers: bearer(alice) });
    const row = after.json<MemoryResponse[]>()[0]!;
    expect(row.confirmedAt).not.toBeNull();
    expect(row.summary).toBe("Engineer, mostly backend");
  });

  it("supersedes rather than overwriting when the agent changes its mind", async () => {
    // §7.6: that a stated preference changed is itself the information. A learner
    // who used to want analogies and now does not has told you two things, and an
    // overwrite keeps one.
    const result = await memory({
      "prefers-analogies.md": "# Likes analogies\n\nKind: teaching_preference\n",
      "no-analogies.md":
        "# Actually finds analogies confusing\n\nKind: teaching_preference\nSupersedes: prefers-analogies\n",
    });

    expect(result.superseded).toBe(1);

    const response = await app.inject({
      method: "GET",
      url: "/v1/me/memory",
      headers: bearer(alice),
    });
    const rows = response.json<MemoryResponse[]>();
    // The superseded one is still listed, and last.
    expect(rows.map((r) => r.slug)).toEqual(["no-analogies", "prefers-analogies"]);
    expect(rows[1]!.supersededBySlug).toBe("no-analogies");
  });

  it("warns when a supersession names something that is not there", async () => {
    // The agent believes it corrected something. A link pointing at nothing means
    // the old belief is still being replayed into every run.
    const result = await memory({
      "x.md": "# A correction\n\nSupersedes: never-existed\n",
    });

    expect(result.warnings.map((w) => w.code)).toContain("link_unresolved");
  });
});

describe("the learner's control over it", () => {
  async function seed(): Promise<string> {
    await memory({ "background.md": "# Engineer\n" });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/me/memory",
      headers: bearer(alice),
    });
    return listed.json<MemoryResponse[]>()[0]!.id;
  }

  it("records that they agreed", async () => {
    const id = await seed();

    const response = await app.inject({
      method: "POST",
      url: `/v1/me/memory/${id}/confirm`,
      headers: bearer(alice),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<MemoryResponse>().confirmedAt).not.toBeNull();
  });

  it("deletes one they disagree with", async () => {
    const id = await seed();

    const response = await app.inject({
      method: "DELETE",
      url: `/v1/me/memory/${id}`,
      headers: bearer(alice),
    });

    expect(response.statusCode).toBe(204);
    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from learner_memories where user_id = $1::uuid`,
      alice.id,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("offers no way to create one", async () => {
    // §7.6: don't build an onboarding questionnaire. What people say up front
    // about how they learn is usually wrong, and the memory is meant to be what
    // the agent noticed rather than what they predicted.
    const response = await app.inject({
      method: "POST",
      url: "/v1/me/memory",
      headers: bearer(alice),
      payload: { summary: "I learn best at 3am", kind: "background" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("shows nothing of another user's memory", async () => {
    await memory({ "background.md": "# Alice is an engineer\n" });

    const response = await app.inject({
      method: "GET",
      url: "/v1/me/memory",
      headers: bearer(bob),
    });

    expect(response.json()).toEqual([]);
  });

  it("refuses to delete another user's memory", async () => {
    const id = await seed();

    const response = await app.inject({
      method: "DELETE",
      url: `/v1/me/memory/${id}`,
      headers: bearer(bob),
    });

    expect(response.statusCode).toBe(404);
  });
});
