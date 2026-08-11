import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * Queueing a teach run (FR-T3), end to end.
 *
 * Three things live here that no unit test can reach:
 *
 * - **The partial unique index is the concurrency control.** §7.3 used to say a
 *   BullMQ job key enforced one run per mission; there is no queue, so the 409
 *   comes from Postgres raising `23505` and the repository turning it into a
 *   `null`. Only a real index can show that.
 * - **`workspace_key` is set once.** It has existed since M0 with a comment
 *   saying so and nothing has ever written it, so the first thing that does needs
 *   to be watched — including through a rename, which must not move the prefix.
 * - **RLS.** Another user's mission is a 404, not a 403.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;

interface RunResponse {
  id: string;
  missionId: string | null;
  kind: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * Inserted directly rather than through `POST /v1/missions`.
 *
 * The WIP limit is three active missions (FR-M4), and this suite needs a dozen —
 * going through the endpoint would make every test after the third fail with a
 * 409 about a rule it is not testing. The rows are identical either way, and RLS
 * still applies to everything the suite then does with them.
 */
async function createMission(user: TestUser, topic: string): Promise<string> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2, 'active', now(), now()) returning id`,
    user.id,
    topic,
  );
  return rows[0]!.id;
}

/** A module, so the mission counts as having a curriculum. */
async function seedTrack(user: TestUser, missionId: string): Promise<void> {
  await db.$executeRawUnsafe(
    `insert into tracks (id, user_id, mission_id, slug, name, position, status, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, 'basics', 'Basics', 1, 'active', now(), now())`,
    user.id,
    missionId,
  );
}

function teach(user: TestUser, missionId: string) {
  return app.inject({
    method: "POST",
    url: `/v1/missions/${missionId}/teach`,
    headers: bearer(user),
  });
}

beforeAll(async () => {
  app = await bootApp();
  db = adminDb();
  alice = await signUp();
  bob = await signUp();
});

afterAll(async () => {
  await deleteUsers(db, [alice.id, bob.id]);
  await app.close();
  await db.$disconnect();
});

beforeEach(async () => {
  // Missions rather than just runs, and it cascades to both. `workspace_key` is
  // unique per user and derived from the topic, so a mission left behind by an
  // earlier test hands the next one `postgres-row-level-security-2` — a failure
  // about test bleed wearing the costume of a failure about slug derivation.
  await db.$executeRawUnsafe(`delete from missions where user_id = any($1::uuid[])`, [
    alice.id,
    bob.id,
  ]);
});

describe("POST /v1/missions/:id/teach", () => {
  it("returns 202 with a queued run rather than waiting for a lesson", async () => {
    // §6: long operations never block a request. 202 and not 201, because the
    // resource created is the run — saying 201 invites a client to expect a
    // lesson in the body, and one takes minutes.
    //
    // A fresh mission has no modules, so the first press plans the curriculum
    // (FR-K1); the kind itself is asserted by the pair below.
    const missionId = await createMission(alice, "Postgres row-level security");
    const response = await teach(alice, missionId);

    expect(response.statusCode).toBe(202);
    expect(response.json<RunResponse>()).toMatchObject({
      missionId,
      status: "queued",
      startedAt: null,
      finishedAt: null,
    });
  });

  it("refuses a second run while one is active, with a slug the SPA can branch on", async () => {
    // Not an error to explain away: one run per mission is a product rule, and
    // the honest answer to "teach me something" while something is being taught
    // is to say so. The SPA shows the run in progress on this slug.
    const missionId = await createMission(alice, "Rust ownership");
    await teach(alice, missionId);

    const second = await teach(alice, missionId);

    expect(second.statusCode).toBe(409);
    expect(second.json<{ type: string }>().type).toContain("run-already-active");
  });

  it("lets a mission be taught again once its run has finished", async () => {
    // The index is partial for exactly this reason. A non-partial one would let a
    // mission be taught precisely once, forever.
    const missionId = await createMission(alice, "Borrow checker");
    const first = await teach(alice, missionId);
    await db.$executeRawUnsafe(
      `update agent_runs set status = 'succeeded', finished_at = now() where id = $1::uuid`,
      first.json<RunResponse>().id,
    );

    expect((await teach(alice, missionId)).statusCode).toBe(202);
  });

  it("treats succeeded_with_conflicts as finished, not as active", async () => {
    // A conflicted run did its work and kept both versions (§7.4). Counting it as
    // active would wedge the mission until somebody resolved a conflict, turning
    // an honest outcome into a blocker.
    const missionId = await createMission(alice, "Lifetimes");
    const first = await teach(alice, missionId);
    await db.$executeRawUnsafe(
      `update agent_runs set status = 'succeeded_with_conflicts', finished_at = now()
        where id = $1::uuid`,
      first.json<RunResponse>().id,
    );

    expect((await teach(alice, missionId)).statusCode).toBe(202);
  });

  it("lets two different missions run at once", async () => {
    const rust = await createMission(alice, "Rust macros");
    const sql = await createMission(alice, "Window functions");

    expect((await teach(alice, rust)).statusCode).toBe(202);
    expect((await teach(alice, sql)).statusCode).toBe(202);
  });

  it("answers 404 for another user's mission, not 403", async () => {
    // RLS makes "not yours" and "does not exist" the same observation, and that
    // is the right answer to give — a 403 would confirm that some other user owns
    // this id.
    const missionId = await createMission(bob, "Bob's mission");
    const response = await teach(alice, missionId);

    expect(response.statusCode).toBe(404);
  });

  it("rejects an id that is not a uuid before it reaches the database", async () => {
    expect((await teach(alice, "not-a-uuid")).statusCode).toBe(400);
  });
});

describe("workspace_key", () => {
  it("is assigned on the first run and derived from the topic", async () => {
    // The column has existed since M0 and nothing has ever written it. This is
    // the first thing that does.
    const missionId = await createMission(alice, "Postgres row-level security");
    await teach(alice, missionId);

    const rows = await db.$queryRawUnsafe<{ workspace_key: string | null }[]>(
      `select workspace_key from missions where id = $1::uuid`,
      missionId,
    );
    expect(rows[0]!.workspace_key).toBe("postgres-row-level-security");
  });

  it("survives a rename, because it is a path and not a name", async () => {
    // §16.7. Recompute it on a rename and the next run materialises an empty
    // prefix, writes a fresh lesson 0001, and the learner's history is still in
    // Storage under a name nothing points at.
    const missionId = await createMission(alice, "Postgres RLS");
    await teach(alice, missionId);

    await app.inject({
      method: "PATCH",
      url: `/v1/missions/${missionId}`,
      headers: bearer(alice),
      payload: { topic: "Something else entirely" },
    });
    await db.$executeRawUnsafe(`delete from agent_runs where user_id = $1::uuid`, alice.id);
    await teach(alice, missionId);

    const rows = await db.$queryRawUnsafe<{ workspace_key: string }[]>(
      `select workspace_key from missions where id = $1::uuid`,
      missionId,
    );
    expect(rows[0]!.workspace_key).toBe("postgres-rls");
  });

  it("disambiguates two of one user's missions on the same topic", async () => {
    const first = await createMission(alice, "Graph theory");
    const second = await createMission(alice, "Graph theory");
    await teach(alice, first);
    await teach(alice, second);

    const rows = await db.$queryRawUnsafe<{ workspace_key: string }[]>(
      `select workspace_key from missions where id = any($1::uuid[]) order by workspace_key`,
      [first, second],
    );
    expect(rows.map((r) => r.workspace_key)).toEqual(["graph-theory", "graph-theory-2"]);
  });

  it("lets two users hold the same key", async () => {
    // It was globally unique until M3. The Storage path is already scoped by user
    // id, so a global unique would let the first account to claim `rust` take it
    // from everyone — and tell the second person, through the 409, that somebody
    // else has a mission by that name.
    const aliceMission = await createMission(alice, "Kubernetes");
    const bobMission = await createMission(bob, "Kubernetes");

    expect((await teach(alice, aliceMission)).statusCode).toBe(202);
    expect((await teach(bob, bobMission)).statusCode).toBe(202);

    const rows = await db.$queryRawUnsafe<{ workspace_key: string }[]>(
      `select workspace_key from missions where id = any($1::uuid[])`,
      [aliceMission, bobMission],
    );
    expect(rows.map((r) => r.workspace_key)).toEqual(["kubernetes", "kubernetes"]);
  });

  it("refuses a topic that yields no slug rather than writing an empty prefix", async () => {
    // The alternative is a prefix of `workspaces/<uid>/`, which is every other
    // unnamed mission's prefix too — so two missions would share one workspace.
    const missionId = await createMission(alice, "!!!");
    const response = await teach(alice, missionId);

    expect(response.statusCode).toBe(422);
    expect(response.json<{ type: string }>().type).toContain("workspace-key-unavailable");
  });
});

describe("GET /v1/agent-runs/:id", () => {
  it("returns the run", async () => {
    const missionId = await createMission(alice, "Type theory");
    const { id } = (await teach(alice, missionId)).json<RunResponse>();

    const response = await app.inject({
      method: "GET",
      url: `/v1/agent-runs/${id}`,
      headers: bearer(alice),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<RunResponse>()).toMatchObject({ id, status: "queued" });
  });

  it("does not expose the heartbeat", async () => {
    // A liveness lease between the worker and the reaper. On the wire it invites
    // a client to reimplement staleness — a second, differently-wrong opinion
    // about whether a run is alive.
    const missionId = await createMission(alice, "Category theory");
    const { id } = (await teach(alice, missionId)).json<RunResponse>();

    const response = await app.inject({
      method: "GET",
      url: `/v1/agent-runs/${id}`,
      headers: bearer(alice),
    });

    expect(response.json()).not.toHaveProperty("heartbeatAt");
  });

  it("answers 404 for another user's run", async () => {
    const missionId = await createMission(bob, "Bob's other mission");
    const { id } = (await teach(bob, missionId)).json<RunResponse>();

    const response = await app.inject({
      method: "GET",
      url: `/v1/agent-runs/${id}`,
      headers: bearer(alice),
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("GET /v1/missions/:id/agent-runs", () => {
  it("lists a mission's runs, newest first", async () => {
    const missionId = await createMission(alice, "Distributed systems");
    const first = (await teach(alice, missionId)).json<RunResponse>();
    await db.$executeRawUnsafe(
      `update agent_runs set status = 'succeeded', finished_at = now() where id = $1::uuid`,
      first.id,
    );
    const second = (await teach(alice, missionId)).json<RunResponse>();

    const response = await app.inject({
      method: "GET",
      url: `/v1/missions/${missionId}/agent-runs`,
      headers: bearer(alice),
    });

    expect(response.json<RunResponse[]>().map((run) => run.id)).toEqual([second.id, first.id]);
  });

  it("shows nothing for another user's mission", async () => {
    const missionId = await createMission(bob, "Bob's third mission");
    await teach(bob, missionId);

    const response = await app.inject({
      method: "GET",
      url: `/v1/missions/${missionId}/agent-runs`,
      headers: bearer(alice),
    });

    expect(response.json()).toEqual([]);
  });
});

/**
 * Which agent one button starts (FR-K1).
 *
 * Over HTTP because the inference reads a table the use case does not own: the
 * unit test proves the branch, and this proves the query behind it — a mission's
 * modules live in `tracks`, and a reader that looked at the wrong thing would give
 * a plausible answer for every mission.
 *
 * The failure it rules out is the state M4 exists to remove: a lesson taught
 * against no curriculum, which produces material with no plan to file it under.
 */
describe("the first press plans, and every press after it teaches", () => {
  it("queues a curriculum run for a mission with no modules", async () => {
    const missionId = await createMission(alice, "Distributed systems");

    expect((await teach(alice, missionId)).json<RunResponse>().kind).toBe("generate_curriculum");
  });

  it("queues a lesson run once the mission has one", async () => {
    const missionId = await createMission(alice, "Distributed systems");
    await seedTrack(alice, missionId);

    expect((await teach(alice, missionId)).json<RunResponse>().kind).toBe("generate_lesson");
  });
});
