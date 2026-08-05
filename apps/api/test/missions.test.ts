import { MISSION_WIP_LIMIT } from "@mindforge/core";
import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * The capture loop's first vertical slice, end to end (§13.2 "API routes").
 *
 * Real DI graph, real Postgres, real Supabase-issued ES256 tokens, HTTP in and out.
 * The unit suite already covers the WIP limit and the revision rules against a fake;
 * what only this level can prove is that the JWKS verifier accepts a genuine token,
 * that RLS isolates through the whole request path, and that a broken rule leaves as
 * `application/problem+json` with a translated `detail`.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;

interface ProblemResponse {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  errors: { field: string; code: string; message: string }[];
}

interface MissionResponse {
  id: string;
  topic: string;
  why: string | null;
  successLooksLike: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// Branching rather than spreading an optional key: `exactOptionalPropertyTypes`
// makes `{ payload?: T }` and `{}` genuinely different types, so a conditional
// spread produces a union light-my-request will not accept.
function post(url: string, user: TestUser | null, payload?: object) {
  const headers = user ? bearer(user) : {};
  return payload === undefined
    ? app.inject({ method: "POST", url, headers })
    : app.inject({ method: "POST", url, headers, payload });
}

function patch(url: string, user: TestUser | null, payload: object) {
  return app.inject({ method: "PATCH", url, headers: user ? bearer(user) : {}, payload });
}

function get(url: string, user: TestUser | null, extra: Record<string, string> = {}) {
  return app.inject({
    method: "GET",
    url,
    headers: { ...(user ? bearer(user) : {}), ...extra },
  });
}

async function createMission(user: TestUser, topic: string): Promise<MissionResponse> {
  const response = await post("/v1/missions", user, { topic });
  expect(response.statusCode, response.body).toBe(201);
  return JSON.parse(response.body) as MissionResponse;
}

beforeAll(async () => {
  db = adminDb();
  app = await bootApp();
  [alice, bob] = await Promise.all([signUp(), signUp()]);
});

afterAll(async () => {
  await deleteUsers(db, [alice.id, bob.id].filter(Boolean));
  await db.$disconnect();
  await app.close();
});

beforeEach(async () => {
  // Each test starts from an empty account. Missions are the WIP-limited resource,
  // so leftovers from one test would make an unrelated one fail with a 409.
  await db.$executeRawUnsafe(`delete from missions where user_id = any($1::uuid[])`, [
    alice.id,
    bob.id,
  ]);
});

describe("authentication", () => {
  it("rejects a request with no token", async () => {
    const response = await get("/v1/missions", null);

    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toContain("application/problem+json");

    const problem = JSON.parse(response.body) as ProblemResponse;
    expect(problem.type).toBe("https://mindforge.app/errors/unauthenticated");
    expect(problem.detail).toBe("Sign in to continue.");
  });

  it("rejects a forged token", async () => {
    // Structurally a JWT, signed by nobody Supabase knows. This is the assertion the
    // unit suite cannot make: it stubs the verifier, so only here does the real
    // JWKS check get exercised.
    const forged = [
      "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9",
      "eyJzdWIiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEiLCJhdWQiOiJhdXRoZW50aWNhdGVkIn0",
      "not-a-real-signature",
    ].join(".");

    const response = await app.inject({
      method: "GET",
      url: "/v1/missions",
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("accepts a token Supabase actually issued", async () => {
    const response = await get("/v1/missions", alice);
    expect(response.statusCode, response.body).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ missions: [] });
  });

  it("leaves the health probe public", async () => {
    const response = await get("/v1/health", null);
    expect(response.statusCode).toBe(200);
  });
});

describe("creating a mission", () => {
  it("creates one and returns the view shape", async () => {
    const response = await post("/v1/missions", alice, {
      topic: "Rust ownership",
      why: "I keep fighting the borrow checker",
    });

    expect(response.statusCode, response.body).toBe(201);
    const mission = JSON.parse(response.body) as MissionResponse & { userId?: string };

    expect(mission.topic).toBe("Rust ownership");
    expect(mission.why).toBe("I keep fighting the borrow checker");
    expect(mission.status).toBe("active");
    expect(mission.successLooksLike).toBeNull();
    // The caller is the owner by construction, so echoing it back would be noise a
    // client could start keying off.
    expect(mission).not.toHaveProperty("userId");
  });

  it("writes a row owned by the authenticated user", async () => {
    const mission = await createMission(alice, "Rust ownership");

    const rows = await db.$queryRawUnsafe<{ user_id: string }[]>(
      `select user_id from missions where id = $1::uuid`,
      mission.id,
    );
    expect(rows[0]?.user_id).toBe(alice.id);
  });

  it("trims the topic rather than storing what was typed", async () => {
    const mission = await createMission(alice, "   Rust ownership   ");
    expect(mission.topic).toBe("Rust ownership");
  });

  it("stores an empty prose field as null, not as an empty string", async () => {
    // Otherwise "" and null both mean absent, and every read has to check for both.
    const response = await post("/v1/missions", alice, { topic: "Rust", why: "" });
    expect((JSON.parse(response.body) as MissionResponse).why).toBeNull();
  });

  describe("validation", () => {
    it("reports a too-short topic as 422 with a field error", async () => {
      const response = await post("/v1/missions", alice, { topic: "no" });

      expect(response.statusCode).toBe(422);
      const problem = JSON.parse(response.body) as ProblemResponse;
      expect(problem.type).toBe("https://mindforge.app/errors/validation-failed");
      expect(problem.errors).toHaveLength(1);
      expect(problem.errors[0]).toMatchObject({ field: "topic", code: "too_small" });
    });

    it("reports a missing topic", async () => {
      const response = await post("/v1/missions", alice, { why: "no topic given" });
      expect(response.statusCode).toBe(422);
      expect((JSON.parse(response.body) as ProblemResponse).errors[0]?.field).toBe("topic");
    });

    it("ignores fields a client is not allowed to set", async () => {
      // A client-supplied status would put the park/unpark rules on the client's
      // honour; the schema strips it rather than rejecting, so an over-eager client
      // still works.
      const response = await post("/v1/missions", alice, {
        topic: "Rust ownership",
        status: "completed",
        userId: bob.id,
      });
      const mission = JSON.parse(response.body) as MissionResponse;
      expect(mission.status).toBe("active");

      const rows = await db.$queryRawUnsafe<{ user_id: string }[]>(
        `select user_id from missions where id = $1::uuid`,
        mission.id,
      );
      expect(rows[0]?.user_id).toBe(alice.id);
    });
  });

  describe("the WIP limit (FR-M4)", () => {
    it(`refuses the mission past ${MISSION_WIP_LIMIT} with a 409 naming the limit`, async () => {
      for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) {
        await createMission(alice, `Mission ${i}`);
      }

      const response = await post("/v1/missions", alice, { topic: "One too many" });

      expect(response.statusCode).toBe(409);
      const problem = JSON.parse(response.body) as ProblemResponse;
      expect(problem.type).toBe("https://mindforge.app/errors/wip-limit-reached");
      expect(problem.detail).toBe(
        `You have ${MISSION_WIP_LIMIT} active missions. Park one before starting another.`,
      );
      expect(problem.instance).toBe("/v1/missions");
      expect(problem.errors).toEqual([]);
    });

    it("counts each user's missions separately", async () => {
      for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) {
        await createMission(alice, `Alice ${i}`);
      }
      // Bob is unaffected by how busy Alice is.
      await expect(createMission(bob, "Bob's first")).resolves.toMatchObject({ status: "active" });
    });

    it("frees a slot when a mission is parked", async () => {
      const first = await createMission(alice, "To be parked");
      for (let i = 1; i < MISSION_WIP_LIMIT; i += 1) await createMission(alice, `Mission ${i}`);

      await expect(post("/v1/missions", alice, { topic: "Blocked" })).resolves.toMatchObject({
        statusCode: 409,
      });

      expect((await post(`/v1/missions/${first.id}/park`, alice)).statusCode).toBe(201);
      await expect(createMission(alice, "Now allowed")).resolves.toMatchObject({
        status: "active",
      });
    });
  });
});

describe("isolation between users (FR-A3)", () => {
  it("does not list another user's missions", async () => {
    await createMission(bob, "Bob's private mission");

    const response = await get("/v1/missions", alice);
    expect(JSON.parse(response.body)).toEqual({ missions: [] });
  });

  it("reports another user's mission as not found, even with the right id", async () => {
    // Knowing the id must not be enough, and the answer must not distinguish "not
    // yours" from "does not exist" — a 403 would confirm the id belongs to someone.
    const bobs = await createMission(bob, "Bob's private mission");

    const response = await get(`/v1/missions/${bobs.id}`, alice);
    expect(response.statusCode).toBe(404);
    expect((JSON.parse(response.body) as ProblemResponse).type).toBe(
      "https://mindforge.app/errors/mission-not-found",
    );
  });

  it("cannot edit another user's mission", async () => {
    const bobs = await createMission(bob, "Bob's private mission");

    const response = await patch(`/v1/missions/${bobs.id}`, alice, { topic: "Hijacked" });
    expect(response.statusCode).toBe(404);

    const rows = await db.$queryRawUnsafe<{ topic: string }[]>(
      `select topic from missions where id = $1::uuid`,
      bobs.id,
    );
    expect(rows[0]?.topic).toBe("Bob's private mission");
  });

  it("cannot park another user's mission", async () => {
    const bobs = await createMission(bob, "Bob's private mission");
    expect((await post(`/v1/missions/${bobs.id}/park`, alice)).statusCode).toBe(404);
  });
});

describe("editing a mission (FR-M1, FR-M2)", () => {
  it("applies the change", async () => {
    const mission = await createMission(alice, "Rust ownership");

    const response = await patch(`/v1/missions/${mission.id}`, alice, {
      topic: "Rust lifetimes",
      reason: "narrowed scope",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect((JSON.parse(response.body) as MissionResponse).topic).toBe("Rust lifetimes");
  });

  it("appends a revision recording what moved and why", async () => {
    const mission = await createMission(alice, "Rust ownership");
    await patch(`/v1/missions/${mission.id}`, alice, {
      topic: "Rust lifetimes",
      reason: "narrowed scope",
    });

    const revisions = await db.$queryRawUnsafe<{ reason: string; snapshot: unknown }[]>(
      `select reason, snapshot from mission_revisions where mission_id = $1::uuid`,
      mission.id,
    );

    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.reason).toBe("narrowed scope");
    expect(revisions[0]?.snapshot).toEqual({
      changed: ["topic"],
      previous: { topic: "Rust ownership" },
    });
  });

  it("appends nothing when the edit changes no value", async () => {
    const mission = await createMission(alice, "Rust ownership");
    await patch(`/v1/missions/${mission.id}`, alice, { topic: "Rust ownership" });

    const revisions = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from mission_revisions where mission_id = $1::uuid`,
      mission.id,
    );
    expect(Number(revisions[0]?.count)).toBe(0);
  });

  it("clears a field when sent null, and leaves omitted fields alone", async () => {
    const created = await post("/v1/missions", alice, {
      topic: "Rust",
      why: "borrow checker",
      constraints: "evenings",
    });
    const mission = JSON.parse(created.body) as MissionResponse;

    const response = await patch(`/v1/missions/${mission.id}`, alice, { why: null });

    const updated = JSON.parse(response.body) as MissionResponse & { constraints: string | null };
    expect(updated.why).toBeNull();
    expect(updated.constraints).toBe("evenings");
  });

  it("rejects a body that changes nothing at all", async () => {
    const mission = await createMission(alice, "Rust ownership");
    const response = await patch(`/v1/missions/${mission.id}`, alice, {
      reason: "just a reason, no change",
    });
    expect(response.statusCode).toBe(422);
  });

  it("reports a malformed id as a client error, not a 500", async () => {
    // Without validation at the boundary this reaches Postgres as a failed uuid cast
    // and comes back as a driver-level 500.
    const response = await patch("/v1/missions/not-a-uuid", alice, { topic: "Anything" });
    expect(response.statusCode).toBe(422);
  });
});

describe("parking (FR-M4b)", () => {
  it("parks and unparks", async () => {
    const mission = await createMission(alice, "Rust ownership");

    const parked = await post(`/v1/missions/${mission.id}/park`, alice);
    expect((JSON.parse(parked.body) as MissionResponse).status).toBe("parked");

    const unparked = await post(`/v1/missions/${mission.id}/unpark`, alice);
    expect((JSON.parse(unparked.body) as MissionResponse).status).toBe("active");
  });

  it("refuses to park a mission twice", async () => {
    const mission = await createMission(alice, "Rust ownership");
    await post(`/v1/missions/${mission.id}/park`, alice);

    const response = await post(`/v1/missions/${mission.id}/park`, alice);
    expect(response.statusCode).toBe(409);
    expect((JSON.parse(response.body) as ProblemResponse).type).toBe(
      "https://mindforge.app/errors/mission-not-active",
    );
  });

  it("enforces the WIP limit on unpark", async () => {
    const parked = await createMission(alice, "To be parked");
    await post(`/v1/missions/${parked.id}/park`, alice);
    for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) await createMission(alice, `Active ${i}`);

    const response = await post(`/v1/missions/${parked.id}/unpark`, alice);
    expect(response.statusCode).toBe(409);
    expect((JSON.parse(response.body) as ProblemResponse).type).toBe(
      "https://mindforge.app/errors/wip-limit-reached",
    );
  });

  it("keeps a parked mission out of the active list but still readable", async () => {
    // Parked is not archived (FR-M4b): the mission is still there, still yours, and
    // still counted by history.
    const mission = await createMission(alice, "Rust ownership");
    await post(`/v1/missions/${mission.id}/park`, alice);

    const active = await get("/v1/missions?status=active", alice);
    expect((JSON.parse(active.body) as { missions: MissionResponse[] }).missions).toEqual([]);

    const all = await get("/v1/missions", alice);
    expect((JSON.parse(all.body) as { missions: MissionResponse[] }).missions).toHaveLength(1);
  });

  it("rejects an unknown status filter", async () => {
    const response = await get("/v1/missions?status=nonsense", alice);
    expect(response.statusCode).toBe(422);
  });
});

describe("translated error detail (§5.2, §6.1)", () => {
  it("uses the user's stored locale, not the request's Accept-Language", async () => {
    // The chain this proves: the guard reads the profile, the context carries the
    // locale, and the exception filter renders `detail` from it — with an English
    // header actively arguing for the wrong answer.
    await db.$executeRawUnsafe(
      `update profiles set locale = 'pt-BR' where id = $1::uuid`,
      alice.id,
    );
    try {
      for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) await createMission(alice, `Mission ${i}`);

      const response = await app.inject({
        method: "POST",
        url: "/v1/missions",
        headers: { ...bearer(alice), "accept-language": "en-US,en;q=0.9" },
        payload: { topic: "Uma a mais" },
      });

      expect(response.statusCode).toBe(409);
      const problem = JSON.parse(response.body) as ProblemResponse;
      expect(problem.detail).toBe(
        `Você tem ${MISSION_WIP_LIMIT} missões ativas. Pause uma antes de começar outra.`,
      );
      // Machine keys stay stable across locales, or the SPA could not branch on them.
      expect(problem.type).toBe("https://mindforge.app/errors/wip-limit-reached");
    } finally {
      await db.$executeRawUnsafe(`update profiles set locale = 'en' where id = $1::uuid`, alice.id);
    }
  });
});
