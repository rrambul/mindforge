import { COLD_START_CHIPS, PINNED_FRICTION_TYPE } from "@mindforge/core";
import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * The capture loop, end to end (§13.2 "API routes").
 *
 * This is the milestone's finish line — "ten real focus sessions logged without opening the
 * code" — so what it proves matters more than the count: that a session actually persists across
 * requests, that RLS isolates it, and that a replayed capture converges on one row rather than
 * two. The last one is the whole basis of the offline queue, and it is not observable at all in
 * a unit test against a fake repository.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;

interface SessionResponse {
  id: string;
  intention: string | null;
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  isRunning: boolean;
  entryMode: string;
  hitIntention: string | null;
  focusQuality: number | null;
  energy: number | null;
  missionId: string | null;
}

interface ProblemResponse {
  type: string;
  status: number;
  detail: string;
}

function post(url: string, user: TestUser | null, payload?: object) {
  const headers = user ? bearer(user) : {};
  return payload === undefined
    ? app.inject({ method: "POST", url, headers })
    : app.inject({ method: "POST", url, headers, payload });
}

function get(url: string, user: TestUser | null) {
  return app.inject({ method: "GET", url, headers: user ? bearer(user) : {} });
}

async function startSession(user: TestUser, payload: object = {}): Promise<SessionResponse> {
  const response = await post("/v1/focus/sessions/start", user, payload);
  expect(response.statusCode, response.body).toBe(201);
  return JSON.parse(response.body) as SessionResponse;
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
  // A leftover running session would make an unrelated test fail with a 409.
  const ids = [alice.id, bob.id];
  await db.$executeRawUnsafe(`delete from friction_events where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from focus_sessions where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from missions where user_id = any($1::uuid[])`, ids);
});

describe("the loop", () => {
  it("starts, runs, stops, and debriefs", async () => {
    const started = await startSession(alice, {
      intention: "get the parser handling nested groups",
    });

    expect(started.isRunning).toBe(true);
    expect(started.endedAt).toBeNull();
    // Withheld while running: elapsed time is a function of now, and a server-rendered figure
    // would be stale the instant it arrived. The client ticks it.
    expect(started.minutes).toBeNull();
    expect(started.entryMode).toBe("timer");

    const running = JSON.parse((await get("/v1/focus/sessions/running", alice)).body) as {
      session: SessionResponse | null;
    };
    expect(running.session?.id).toBe(started.id);

    const stopped = JSON.parse(
      (await post(`/v1/focus/sessions/${started.id}/stop`, alice)).body,
    ) as SessionResponse;
    expect(stopped.isRunning).toBe(false);
    expect(stopped.minutes).not.toBeNull();

    const debriefed = JSON.parse(
      (
        await post(`/v1/focus/sessions/${started.id}/debrief`, alice, {
          hitIntention: "partly",
          focusQuality: 4,
          energy: 3,
        })
      ).body,
    ) as SessionResponse;

    expect(debriefed.hitIntention).toBe("partly");
    expect(debriefed.focusQuality).toBe(4);
    expect(debriefed.energy).toBe(3);
  });

  it("reports nothing running on a fresh account", async () => {
    const response = await get("/v1/focus/sessions/running", alice);
    expect(response.statusCode).toBe(200);
    // An envelope rather than a bare `null` body, which is awkward for every client.
    expect(JSON.parse(response.body)).toEqual({ session: null });
  });

  it("refuses a second concurrent session and names the one in the way", async () => {
    const first = await startSession(alice);
    const response = await post("/v1/focus/sessions/start", alice, {});

    expect(response.statusCode).toBe(409);
    const problem = JSON.parse(response.body) as ProblemResponse;
    expect(problem.type).toBe("https://mindforge.app/errors/focus-session-already-running");
    expect(problem.detail).toBe("A focus session is already running. Stop it first.");

    // And the running one is untouched — auto-stopping would end a block without a debrief.
    const running = JSON.parse((await get("/v1/focus/sessions/running", alice)).body) as {
      session: SessionResponse | null;
    };
    expect(running.session?.id).toBe(first.id);
  });

  it("frees the slot once stopped", async () => {
    const first = await startSession(alice);
    await post(`/v1/focus/sessions/${first.id}/stop`, alice);
    await expect(startSession(alice)).resolves.toMatchObject({ isRunning: true });
  });

  it("refuses a debrief while the session is still running", async () => {
    const started = await startSession(alice);
    const response = await post(`/v1/focus/sessions/${started.id}/debrief`, alice, {
      hitIntention: "yes",
    });

    expect(response.statusCode).toBe(409);
    expect((JSON.parse(response.body) as ProblemResponse).type).toBe(
      "https://mindforge.app/errors/focus-session-not-stopped",
    );
  });

  it("binds a session to a mission", async () => {
    const mission = JSON.parse(
      (await post("/v1/missions", alice, { topic: "Rust ownership" })).body,
    ) as { id: string };

    const started = await startSession(alice, { missionId: mission.id });
    expect(started.missionId).toBe(mission.id);

    const listed = JSON.parse(
      (await get(`/v1/focus/sessions?missionId=${mission.id}`, alice)).body,
    ) as { sessions: SessionResponse[] };
    expect(listed.sessions).toHaveLength(1);
  });
});

describe("idempotency (§6.1)", () => {
  it("converges on one session when a start is replayed", async () => {
    // The whole basis of the offline queue: it cannot know whether its first attempt landed, so
    // replaying must be free rather than an error or a duplicate.
    const id = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const first = await startSession(alice, { id, intention: "first" });
    const replay = await startSession(alice, { id, intention: "different" });

    expect(replay.id).toBe(first.id);
    expect(replay.intention).toBe("first");

    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from focus_sessions where id = $1::uuid`,
      id,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("does not move the end time when a stop is replayed", async () => {
    const started = await startSession(alice);
    const first = JSON.parse(
      (await post(`/v1/focus/sessions/${started.id}/stop`, alice)).body,
    ) as SessionResponse;

    const replay = JSON.parse(
      (await post(`/v1/focus/sessions/${started.id}/stop`, alice)).body,
    ) as SessionResponse;

    // A block ended when it ended. A replayed stop that moved it would inflate the duration by
    // however long the client was offline.
    expect(replay.endedAt).toBe(first.endedAt);
  });

  it("converges on one friction event when a tap is replayed", async () => {
    const id = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
    await post("/v1/friction", alice, { id, type: "tooling" });
    await post("/v1/friction", alice, { id, type: "tooling" });

    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from friction_events where user_id = $1::uuid`,
      alice.id,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });
});

describe("friction (FR-C1, FR-C2)", () => {
  it("logs from a type alone, defaulting intensity to 3", async () => {
    const response = await post("/v1/friction", alice, { type: "tooling" });

    expect(response.statusCode, response.body).toBe(201);
    const event = JSON.parse(response.body) as { type: string; intensity: number };
    expect(event.type).toBe("tooling");
    // §5.3: never asked inline. The answer you would give while annoyed is not better than 3.
    expect(event.intensity).toBe(3);
  });

  it("attaches to the running session", async () => {
    const session = await startSession(alice);
    const event = JSON.parse(
      (await post("/v1/friction", alice, { type: "interruption", sessionId: session.id })).body,
    ) as { sessionId: string | null };

    expect(event.sessionId).toBe(session.id);
  });

  it("rejects a type outside the taxonomy", async () => {
    const response = await post("/v1/friction", alice, { type: "annoyed" });
    expect(response.statusCode).toBe(422);
  });

  it("serves the cold-start chips before there is any history", async () => {
    const chips = JSON.parse((await get("/v1/friction/chips", alice)).body) as {
      inline: string[];
      overflow: string[];
    };

    expect(chips.inline).toEqual(COLD_START_CHIPS);
    expect(chips.inline).toHaveLength(4);
    expect(chips.inline.length + chips.overflow.length).toBe(11);
  });

  it("promotes what you actually log, and keeps the pinned type", async () => {
    for (let i = 0; i < 4; i += 1) await post("/v1/friction", alice, { type: "physical" });
    for (let i = 0; i < 2; i += 1) await post("/v1/friction", alice, { type: "avoidance" });

    const chips = JSON.parse((await get("/v1/friction/chips", alice)).body) as { inline: string[] };
    expect(chips.inline[0]).toBe("physical");
    expect(chips.inline[1]).toBe("avoidance");
    expect(chips.inline.at(-1)).toBe(PINNED_FRICTION_TYPE);
  });

  it("computes the ember share from the session's outcome, not from a stored column", async () => {
    // The same type, opposite meanings, decided by whether the block arrived anywhere. This is
    // the product's headline distinction and it is derived on every read.
    const session = await startSession(alice);
    await post("/v1/friction", alice, { type: "too_hard", sessionId: session.id });
    await post(`/v1/focus/sessions/${session.id}/stop`, alice);
    await post(`/v1/focus/sessions/${session.id}/debrief`, alice, { hitIntention: "yes" });

    const productive = JSON.parse((await get("/v1/friction/summary", alice)).body) as {
      emberShare: number | null;
      eventCount: number;
    };
    expect(productive.emberShare).toBe(1);
    expect(productive.eventCount).toBe(1);

    // Now say the block went nowhere. The same event flips to slag.
    await post(`/v1/focus/sessions/${session.id}/debrief`, alice, { hitIntention: "no" });
    const wasted = JSON.parse((await get("/v1/friction/summary", alice)).body) as {
      emberShare: number | null;
    };
    expect(wasted.emberShare).toBe(0);
  });

  it("reports a null ember share when nothing has been logged", async () => {
    // Not zero: "no friction logged" and "all of it was wasteful" are different claims.
    const summary = JSON.parse((await get("/v1/friction/summary", alice)).body) as {
      emberShare: number | null;
    };
    expect(summary.emberShare).toBeNull();
  });
});

describe("manual entry (FR-F2)", () => {
  it("records a session you forgot to time", async () => {
    const response = await post("/v1/focus/sessions", alice, {
      startedAt: "2026-08-05T09:00:00.000Z",
      endedAt: "2026-08-05T10:30:00.000Z",
      intention: "read chapter 4",
      hitIntention: "yes",
    });

    expect(response.statusCode, response.body).toBe(201);
    const session = JSON.parse(response.body) as SessionResponse;
    expect(session.minutes).toBe(90);
    expect(session.isRunning).toBe(false);
    // Distinguishable without being second-class.
    expect(["manual", "backfilled"]).toContain(session.entryMode);
  });

  it("works while a session is running", async () => {
    await startSession(alice);
    const response = await post("/v1/focus/sessions", alice, {
      startedAt: "2026-08-04T09:00:00.000Z",
      endedAt: "2026-08-04T10:00:00.000Z",
    });
    expect(response.statusCode).toBe(201);
  });

  it("refuses a session that ends before it starts", async () => {
    const response = await post("/v1/focus/sessions", alice, {
      startedAt: "2026-08-05T10:00:00.000Z",
      endedAt: "2026-08-05T09:00:00.000Z",
    });
    expect(response.statusCode).toBe(422);
  });

  it("refuses a session dated in the future, and says which field", async () => {
    // A skewed device clock or a mistyped year. Either way the block would sort to the top of every
    // recent list permanently and count toward a `focus_hours` goal for work that has not happened.
    const nextYear = new Date(Date.now() + 365 * 86_400_000);
    const response = await post("/v1/focus/sessions", alice, {
      startedAt: nextYear.toISOString(),
      endedAt: new Date(nextYear.getTime() + 3_600_000).toISOString(),
    });

    expect(response.statusCode).toBe(422);
    const problem = JSON.parse(response.body) as { errors: { field: string }[]; detail: string };
    expect(problem.errors[0]?.field).toBe("startedAt");
    // A message about the clock rather than "nothing you did caused this".
    expect(problem.detail).toMatch(/future/i);
  });

  it("refuses a session that started in the past and ends in the future", async () => {
    const response = await post("/v1/focus/sessions", alice, {
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      endedAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(response.statusCode).toBe(422);
    expect((JSON.parse(response.body) as { errors: { field: string }[] }).errors[0]?.field).toBe(
      "endedAt",
    );
  });
});

describe("isolation (FR-A3)", () => {
  it("does not show one user another's running session", async () => {
    await startSession(bob);
    expect(JSON.parse((await get("/v1/focus/sessions/running", alice)).body)).toEqual({
      session: null,
    });
  });

  it("lets each user run a session at the same time", async () => {
    await startSession(alice);
    await expect(startSession(bob)).resolves.toMatchObject({ isRunning: true });
  });

  it("cannot stop another user's session", async () => {
    const bobs = await startSession(bob);
    const response = await post(`/v1/focus/sessions/${bobs.id}/stop`, alice);

    expect(response.statusCode).toBe(404);
    const rows = await db.$queryRawUnsafe<{ ended_at: Date | null }[]>(
      `select ended_at from focus_sessions where id = $1::uuid`,
      bobs.id,
    );
    expect(rows[0]?.ended_at).toBeNull();
  });

  it("keeps friction summaries separate", async () => {
    for (let i = 0; i < 3; i += 1) await post("/v1/friction", bob, { type: "tooling" });
    const summary = JSON.parse((await get("/v1/friction/summary", alice)).body) as {
      eventCount: number;
    };
    expect(summary.eventCount).toBe(0);
  });

  it("requires a token for every capture endpoint", async () => {
    for (const url of ["/v1/focus/sessions/running", "/v1/friction/chips"]) {
      expect((await get(url, null)).statusCode, url).toBe(401);
    }
    expect((await post("/v1/friction", null, { type: "tooling" })).statusCode).toBe(401);
    expect((await post("/v1/focus/sessions/start", null, {})).statusCode).toBe(401);
  });
});
