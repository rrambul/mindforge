import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * Goals end to end (FR-M3, FR-M3b).
 *
 * The integration level earns its keep for three things no unit test reaches: the target definition
 * survives a round trip through a text column, three nullable id columns and a JSON blob; the focus
 * minutes are summed in **raw SQL** that has to agree with `elapsedMinutes` in packages/core; and RLS
 * keeps one person's goals out of another's.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;

interface TargetResponse {
  id: string;
  kind: string;
  weight: number;
  fraction: number | null;
  met: boolean;
  unmeasurable: string | null;
  metAt: string | null;
  resourceId: string | null;
  skillId: string | null;
  missionId: string | null;
  target: Record<string, number | string>;
}

interface GoalResponse {
  id: string;
  title: string;
  targetDate: string | null;
  status: string;
  outcomeNote: string | null;
  fraction: number | null;
  targetCount: number;
  measuredWeight: number;
  totalWeight: number;
  allTargetsMet: boolean;
  targets: TargetResponse[];
}

function post(url: string, user: TestUser | null, payload?: object) {
  const headers = user ? bearer(user) : {};
  return payload === undefined
    ? app.inject({ method: "POST", url, headers })
    : app.inject({ method: "POST", url, headers, payload });
}

function patch(url: string, user: TestUser, payload: object) {
  return app.inject({ method: "PATCH", url, headers: bearer(user), payload });
}

function get(url: string, user: TestUser | null) {
  return app.inject({ method: "GET", url, headers: user ? bearer(user) : {} });
}

async function createGoal(user: TestUser, payload: object): Promise<GoalResponse> {
  const response = await post("/v1/goals", user, payload);
  expect(response.statusCode, response.body).toBe(201);
  return JSON.parse(response.body) as GoalResponse;
}

async function aMission(user: TestUser): Promise<string> {
  const response = await post("/v1/missions", user, { topic: `Mission ${Math.random()}` });
  return (JSON.parse(response.body) as { id: string }).id;
}

async function aBook(user: TestUser, current: number, total: number | null): Promise<string> {
  const created = await post("/v1/resources", user, { type: "book", title: "Programming Rust" });
  const id = (JSON.parse(created.body) as { id: string }).id;
  await patch(`/v1/resources/${id}/progress`, user, {
    current,
    ...(total === null ? {} : { total }),
  });
  return id;
}

/** A finished session of a given length, so `focus_hours` has something real to sum. */
async function aFinishedSession(user: TestUser, missionId: string, minutes: number): Promise<void> {
  const endedAt = new Date("2026-08-06T12:00:00Z");
  const startedAt = new Date(endedAt.getTime() - minutes * 60_000);

  const response = await post("/v1/focus/sessions", user, {
    missionId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    entryMode: "manual",
  });
  expect(response.statusCode, response.body).toBe(201);
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
  const ids = [alice.id, bob.id];
  // Goals first: a target references a resource and a mission, and the cascade only runs one way.
  await db.$executeRawUnsafe(`delete from goals where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from focus_sessions where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from resources where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from missions where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from skills where user_id = any($1::uuid[])`, ids);
});

describe("creating a goal", () => {
  it("takes a title alone and says its progress cannot be measured", async () => {
    // §3.8: a goal with no targets shows a sentence rather than 0% or 100%, and the absence is the
    // nudge to add one.
    const goal = await createGoal(alice, { title: "Ship the parser" });

    expect(goal.fraction).toBeNull();
    expect(goal.targetCount).toBe(0);
    expect(goal.allTargetsMet).toBe(false);
  });

  it("round-trips a typed target through its three columns and the JSON blob", async () => {
    const resourceId = await aBook(alice, 0, 590);
    const goal = await createGoal(alice, {
      title: "Read it properly",
      targets: [{ kind: "resource_progress", resourceId, target: { percent: 80 }, weight: 2 }],
    });

    const target = goal.targets[0]!;
    expect(target.kind).toBe("resource_progress");
    expect(target.resourceId).toBe(resourceId);
    expect(target.skillId).toBeNull();
    expect(target.missionId).toBeNull();
    expect(target.target).toEqual({ percent: 80 });
    expect(target.weight).toBe(2);
  });

  it("keeps the target date as the day the user typed", async () => {
    // A `date` column. Round-tripping through a timestamp would move it a day for anyone west of UTC,
    // and this test would pass in London and fail in São Paulo.
    const goal = await createGoal(alice, { title: "x", targetDate: "2026-09-30" });
    expect(goal.targetDate).toBe("2026-09-30");

    const listed = JSON.parse((await get("/v1/goals", alice)).body) as { goals: GoalResponse[] };
    expect(listed.goals[0]?.targetDate).toBe("2026-09-30");
  });

  it("refuses a target pointing at a resource that does not exist", async () => {
    const response = await post("/v1/goals", alice, {
      title: "x",
      targets: [
        {
          kind: "resource_progress",
          resourceId: "99999999-9999-4999-8999-999999999999",
          target: { percent: 50 },
          weight: 1,
        },
      ],
    });

    expect(response.statusCode).toBe(422);
    const problem = JSON.parse(response.body) as { detail: string; errors: { field: string }[] };
    expect(problem.detail).toContain("resource");
    expect(problem.errors[0]?.field).toBe("resourceId");
  });

  it("refuses a target pointing at another user's mission", async () => {
    // RLS makes it invisible, so this is the same answer as "does not exist" — which is correct: it
    // is not a mission this user can aim at.
    const bobsMission = await aMission(bob);

    const response = await post("/v1/goals", alice, {
      title: "x",
      targets: [{ kind: "focus_hours", missionId: bobsMission, target: { hours: 10 }, weight: 1 }],
    });
    expect(response.statusCode).toBe(422);
  });

  it("accepts no percentage field of its own", async () => {
    // The rule the feature exists for. A client sending one gets a goal without it, not a goal with a
    // self-reported number.
    const goal = await createGoal(alice, { title: "x", fraction: 0.8, progress: 80 });
    expect(goal.fraction).toBeNull();
  });

  it("converges on one goal when a creation is replayed", async () => {
    const id = "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa";
    await createGoal(alice, { id, title: "first" });
    await createGoal(alice, { id, title: "second" });

    const listed = JSON.parse((await get("/v1/goals", alice)).body) as { goals: GoalResponse[] };
    expect(listed.goals).toHaveLength(1);
    expect(listed.goals[0]?.title).toBe("first");
  });
});

describe("progress from real evidence (§3.8)", () => {
  it("reads a resource's own progress", async () => {
    const resourceId = await aBook(alice, 295, 590);
    const goal = await createGoal(alice, {
      title: "Finish the book",
      targets: [{ kind: "resource_progress", resourceId, target: { percent: 100 }, weight: 1 }],
    });

    expect(goal.fraction).toBeCloseTo(0.5);
    expect(goal.targets[0]?.met).toBe(false);
  });

  it("says unmeasurable rather than 0% for a book of unknown length", async () => {
    // 137 pages into something whose length was never recorded is not "no progress".
    const resourceId = await aBook(alice, 137, null);
    const goal = await createGoal(alice, {
      title: "Finish the book",
      targets: [{ kind: "resource_progress", resourceId, target: { percent: 100 }, weight: 1 }],
    });

    expect(goal.fraction).toBeNull();
    expect(goal.targets[0]?.unmeasurable).toBe("no_data");
  });

  it("sums focus minutes the same way the session list does", async () => {
    // The raw SQL has to agree with `elapsedMinutes` in packages/core, or the hours on this screen and
    // the hours beside each session would differ — two places disagreeing about one number.
    const missionId = await aMission(alice);
    await aFinishedSession(alice, missionId, 90);
    await aFinishedSession(alice, missionId, 30);

    const goal = await createGoal(alice, {
      title: "Put the time in",
      targets: [{ kind: "focus_hours", missionId, target: { hours: 4 }, weight: 1 }],
    });

    // Two hours of four.
    expect(goal.fraction).toBeCloseTo(0.5);
  });

  it("does not count a running session, which would make the goal advance on its own", async () => {
    const missionId = await aMission(alice);
    await post("/v1/focus/sessions/start", alice, { missionId });

    const goal = await createGoal(alice, {
      title: "Put the time in",
      targets: [{ kind: "focus_hours", missionId, target: { hours: 1 }, weight: 1 }],
    });

    expect(goal.fraction).toBe(0);
  });

  it("counts zero hours as zero rather than as unknown", async () => {
    // Unlike an unknown book length, no sessions logged is a fact.
    const missionId = await aMission(alice);
    const goal = await createGoal(alice, {
      title: "Put the time in",
      targets: [{ kind: "focus_hours", missionId, target: { hours: 10 }, weight: 1 }],
    });

    expect(goal.fraction).toBe(0);
    expect(goal.targets[0]?.unmeasurable).toBeNull();
  });

  it("reports a skill_band target as not yet measurable in M1", async () => {
    // Scores come from assessments and reviews, which land in M2. "No data yet" would imply an action
    // the user could take, and there is none.
    // The id is supplied explicitly: Prisma's `@default(uuid())` is generated client-side, so the
    // column has no database default and a raw insert has to provide one.
    const skill = await db.$queryRawUnsafe<{ id: string }[]>(
      `insert into skills (id, user_id, name, slug)
       values (gen_random_uuid(), $1::uuid, 'Rust', 'rust-' || gen_random_uuid())
       returning id`,
      alice.id,
    );
    const skillId = skill[0]!.id;

    const goal = await createGoal(alice, {
      title: "Get fluent",
      targets: [{ kind: "skill_band", skillId, target: { band: "fluent" }, weight: 1 }],
    });

    expect(goal.fraction).toBeNull();
    expect(goal.targets[0]?.unmeasurable).toBe("not_yet_implemented");
  });

  it("reports how much of the weight the number covers", async () => {
    // So the client can say "measuring 1 of 2 targets" rather than implying it covers everything.
    const missionId = await aMission(alice);
    await aFinishedSession(alice, missionId, 60);

    const goal = await createGoal(alice, {
      title: "Mixed",
      targets: [
        { kind: "focus_hours", missionId, target: { hours: 2 }, weight: 1 },
        { kind: "artifact", target: {}, weight: 1 },
      ],
    });

    expect(goal.measuredWeight).toBe(1);
    expect(goal.totalWeight).toBe(2);
    expect(goal.fraction).toBeCloseTo(0.5);
  });

  it("is never met while it holds a target it cannot measure", async () => {
    // Otherwise a goal completes itself by containing something the app cannot check.
    const missionId = await aMission(alice);
    await aFinishedSession(alice, missionId, 120);

    const goal = await createGoal(alice, {
      title: "Mixed",
      targets: [
        { kind: "focus_hours", missionId, target: { hours: 1 }, weight: 1 },
        { kind: "artifact", target: {}, weight: 1 },
      ],
    });

    expect(goal.targets.find((t) => t.kind === "focus_hours")?.met).toBe(true);
    expect(goal.allTargetsMet).toBe(false);
  });

  it("stamps met_at on creation when a target is already met", async () => {
    // A goal to read a book you have already finished is met on the first render, and reporting 0%
    // there is the render that decides whether the feature feels trustworthy.
    const resourceId = await aBook(alice, 590, 590);
    const goal = await createGoal(alice, {
      title: "Finish the book",
      targets: [{ kind: "resource_progress", resourceId, target: { percent: 100 }, weight: 1 }],
    });

    expect(goal.targets[0]?.met).toBe(true);
    expect(goal.targets[0]?.metAt).not.toBeNull();
    expect(goal.allTargetsMet).toBe(true);
  });
});

describe("the manual escape hatch", () => {
  it("ticks and unticks, and moves the goal's progress", async () => {
    const goal = await createGoal(alice, {
      title: "Ship it",
      targets: [{ kind: "manual", target: {}, weight: 1 }],
    });
    const targetId = goal.targets[0]!.id;

    const ticked = JSON.parse(
      (await patch(`/v1/goals/${goal.id}/targets/${targetId}/manual`, alice, { satisfied: true }))
        .body,
    ) as GoalResponse;
    expect(ticked.fraction).toBe(1);
    expect(ticked.allTargetsMet).toBe(true);

    const unticked = JSON.parse(
      (await patch(`/v1/goals/${goal.id}/targets/${targetId}/manual`, alice, { satisfied: false }))
        .body,
    ) as GoalResponse;
    expect(unticked.fraction).toBe(0);
    expect(unticked.targets[0]?.metAt).toBeNull();
  });

  it("refuses to set a computed target by hand", async () => {
    const resourceId = await aBook(alice, 10, 100);
    const goal = await createGoal(alice, {
      title: "Read it",
      targets: [{ kind: "resource_progress", resourceId, target: { percent: 100 }, weight: 1 }],
    });

    const response = await patch(
      `/v1/goals/${goal.id}/targets/${goal.targets[0]!.id}/manual`,
      alice,
      { satisfied: true },
    );
    expect(response.statusCode).toBe(409);
  });
});

describe("recompute (FR-M3b)", () => {
  it("notices a target met since the goal was created", async () => {
    const resourceId = await aBook(alice, 100, 590);
    const goal = await createGoal(alice, {
      title: "Finish the book",
      targets: [{ kind: "resource_progress", resourceId, target: { percent: 100 }, weight: 1 }],
    });
    expect(goal.targets[0]?.metAt).toBeNull();

    await patch(`/v1/resources/${resourceId}/progress`, alice, { current: 590 });

    const after = JSON.parse(
      (await post(`/v1/goals/${goal.id}/recompute`, alice)).body,
    ) as GoalResponse;
    expect(after.targets[0]?.met).toBe(true);
    expect(after.targets[0]?.metAt).not.toBeNull();
  });

  it("clears met_at when a target stops being met", async () => {
    // The reason `met_at` is cleared rather than kept as a high-water mark: a goal you met and then
    // let slip is not a goal you hold, and a stale stamp would let a rollup say otherwise.
    const resourceId = await aBook(alice, 590, 590);
    const goal = await createGoal(alice, {
      title: "Finish the book",
      targets: [{ kind: "resource_progress", resourceId, target: { percent: 100 }, weight: 1 }],
    });
    expect(goal.targets[0]?.metAt).not.toBeNull();

    // Corrected downward — you had misremembered where you were.
    await patch(`/v1/resources/${resourceId}/progress`, alice, { current: 100 });

    const after = JSON.parse(
      (await post(`/v1/goals/${goal.id}/recompute`, alice)).body,
    ) as GoalResponse;
    expect(after.targets[0]?.met).toBe(false);
    expect(after.targets[0]?.metAt).toBeNull();

    // Proven in the database, not just the response.
    const rows = await db.$queryRawUnsafe<{ met_at: Date | null }[]>(
      `select met_at from goal_targets where id = $1::uuid`,
      goal.targets[0]!.id,
    );
    expect(rows[0]?.met_at).toBeNull();
  });

  it("does not write on a plain read", async () => {
    // A GET that stamps rows makes every page load a mutation.
    const resourceId = await aBook(alice, 590, 590);
    const goal = await createGoal(alice, {
      title: "x",
      targets: [{ kind: "resource_progress", resourceId, target: { percent: 100 }, weight: 1 }],
    });

    await db.$executeRawUnsafe(
      `update goal_targets set met_at = null where goal_id = $1::uuid`,
      goal.id,
    );
    await get(`/v1/goals/${goal.id}`, alice);

    const rows = await db.$queryRawUnsafe<{ met_at: Date | null }[]>(
      `select met_at from goal_targets where goal_id = $1::uuid`,
      goal.id,
    );
    // Still null: the read reported it as met without recording that it had.
    expect(rows[0]?.met_at).toBeNull();
  });
});

describe("closing and reopening", () => {
  it("closes as missed with the note that makes the record worth keeping", async () => {
    const goal = await createGoal(alice, { title: "x" });
    const closed = JSON.parse(
      (
        await post(`/v1/goals/${goal.id}/close`, alice, {
          status: "missed",
          outcomeNote: "ran out of time",
        })
      ).body,
    ) as GoalResponse;

    expect(closed.status).toBe("missed");
    expect(closed.outcomeNote).toBe("ran out of time");
  });

  it("refuses to close a missed goal without a note", async () => {
    const goal = await createGoal(alice, { title: "x" });
    const response = await post(`/v1/goals/${goal.id}/close`, alice, { status: "missed" });

    expect(response.statusCode).toBe(422);
    const problem = JSON.parse(response.body) as { errors: { field: string }[] };
    expect(problem.errors[0]?.field).toBe("outcomeNote");
  });

  it("refuses to close twice", async () => {
    const goal = await createGoal(alice, { title: "x" });
    await post(`/v1/goals/${goal.id}/close`, alice, { status: "met" });

    expect((await post(`/v1/goals/${goal.id}/close`, alice, { status: "met" })).statusCode).toBe(
      409,
    );
  });

  it("refuses to edit a closed goal", async () => {
    const goal = await createGoal(alice, { title: "x" });
    await post(`/v1/goals/${goal.id}/close`, alice, { status: "met" });

    expect((await patch(`/v1/goals/${goal.id}`, alice, { title: "rewritten" })).statusCode).toBe(
      409,
    );
  });

  it("reopens and clears the note", async () => {
    const goal = await createGoal(alice, { title: "x" });
    await post(`/v1/goals/${goal.id}/close`, alice, {
      status: "abandoned",
      outcomeNote: "changed direction",
    });

    const reopened = JSON.parse(
      (await post(`/v1/goals/${goal.id}/reopen`, alice)).body,
    ) as GoalResponse;
    expect(reopened.status).toBe("active");
    expect(reopened.outcomeNote).toBeNull();
  });

  it("refuses to reopen something that is not closed", async () => {
    const goal = await createGoal(alice, { title: "x" });
    expect((await post(`/v1/goals/${goal.id}/reopen`, alice)).statusCode).toBe(409);
  });
});

describe("targets on an existing goal", () => {
  it("adds one and recomputes immediately", async () => {
    const resourceId = await aBook(alice, 590, 590);
    const goal = await createGoal(alice, { title: "x" });

    const after = JSON.parse(
      (
        await post(`/v1/goals/${goal.id}/targets`, alice, {
          kind: "resource_progress",
          resourceId,
          target: { percent: 100 },
          weight: 1,
        })
      ).body,
    ) as GoalResponse;

    expect(after.targets).toHaveLength(1);
    expect(after.targets[0]?.met).toBe(true);
  });

  it("removes one", async () => {
    const goal = await createGoal(alice, {
      title: "x",
      targets: [{ kind: "manual", target: {}, weight: 1 }],
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/v1/goals/${goal.id}/targets/${goal.targets[0]!.id}`,
      headers: bearer(alice),
    });
    expect(response.statusCode).toBe(200);
    expect((JSON.parse(response.body) as GoalResponse).targets).toEqual([]);
  });

  it("reports a target that is not on this goal rather than deleting nothing quietly", async () => {
    const goal = await createGoal(alice, { title: "x" });
    const response = await app.inject({
      method: "DELETE",
      url: `/v1/goals/${goal.id}/targets/99999999-9999-4999-8999-999999999999`,
      headers: bearer(alice),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("listing", () => {
  it("puts active goals first and closed ones last", async () => {
    // `status` is a text column, so ordering it in SQL would be alphabetical — `abandoned` at the top.
    const met = await createGoal(alice, { title: "met" });
    const abandoned = await createGoal(alice, { title: "abandoned" });
    await createGoal(alice, { title: "active" });

    await post(`/v1/goals/${met.id}/close`, alice, { status: "met" });
    await post(`/v1/goals/${abandoned.id}/close`, alice, {
      status: "abandoned",
      outcomeNote: "no",
    });

    const listed = JSON.parse((await get("/v1/goals", alice)).body) as { goals: GoalResponse[] };
    expect(listed.goals.map((g) => g.title)).toEqual(["active", "met", "abandoned"]);
  });

  it("filters by mission", async () => {
    const missionId = await aMission(alice);
    await createGoal(alice, { title: "on the mission", missionId });
    await createGoal(alice, { title: "loose" });

    const listed = JSON.parse((await get(`/v1/goals?missionId=${missionId}`, alice)).body) as {
      goals: GoalResponse[];
    };
    expect(listed.goals.map((g) => g.title)).toEqual(["on the mission"]);
  });

  it("never lists another user's goals", async () => {
    await createGoal(bob, { title: "bob's goal" });
    const listed = JSON.parse((await get("/v1/goals", alice)).body) as { goals: GoalResponse[] };
    expect(listed.goals).toEqual([]);
  });
});

describe("isolation", () => {
  it("cannot read, edit, or close another user's goal", async () => {
    const bobs = await createGoal(bob, { title: "bob's goal" });

    expect((await get(`/v1/goals/${bobs.id}`, alice)).statusCode).toBe(404);
    expect((await patch(`/v1/goals/${bobs.id}`, alice, { title: "hijacked" })).statusCode).toBe(
      404,
    );
    expect((await post(`/v1/goals/${bobs.id}/close`, alice, { status: "met" })).statusCode).toBe(
      404,
    );

    const rows = await db.$queryRawUnsafe<{ title: string }[]>(
      `select title from goals where id = $1::uuid`,
      bobs.id,
    );
    expect(rows[0]?.title).toBe("bob's goal");
  });

  it("requires a token", async () => {
    expect((await get("/v1/goals", null)).statusCode).toBe(401);
    expect((await post("/v1/goals", null, { title: "x" })).statusCode).toBe(401);
  });
});
