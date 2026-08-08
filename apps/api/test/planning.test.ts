import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminDb,
  bearer,
  bootApp,
  deleteUsers,
  setProfile,
  signUp,
  type TestUser,
} from "./support/stack.js";

/**
 * The weekly rhythm end to end (FR-F5, FR-F6).
 *
 * Four things live here that no unit test can reach:
 *
 * - **`week_start` is a `@db.Date`.** A date that survives Postgres and comes back as the same
 *   Wednesday is the single most likely thing in this module to be off by a day, and only a real
 *   column can show it.
 * - **The actuals are raw SQL** over `focus_sessions`, grouped and floored in Postgres, and it has to
 *   agree with `elapsedMinutes` in packages/core.
 * - **The week is bucketed in the caller's timezone.** A session an hour either side of local
 *   midnight is the test that distinguishes a real implementation from `>= weekStart`.
 * - **RLS.** One person's plan cannot be read, replaced, or reviewed by another.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;

/** 2026-08-03 is a Monday. The 5th is the Wednesday inside the same week. */
const MONDAY = "2026-08-03";
const WEDNESDAY = "2026-08-05";
/** The Sunday that begins the same week for a `weekStartsOn: 0` profile. */
const SUNDAY = "2026-08-02";

interface AllocationResponse {
  missionId: string | null;
  skillId: string | null;
  plannedMinutes: number;
}

interface PlanResponse {
  weekStart: string;
  allocations: AllocationResponse[];
  plannedTotal: number;
}

interface PlanRowResponse {
  subject: { kind: string; id: string };
  label: string | null;
  plannedMinutes: number | null;
  actualMinutes: number;
  deltaMinutes: number | null;
  attainment: number | null;
}

interface ActualResponse {
  weekStart: string;
  rows: PlanRowResponse[];
  plannedTotal: number;
  actualTotal: number;
  unplannedMinutes: number;
  attainment: number | null;
}

interface ReviewResponse {
  id: string;
  weekStart: string;
  completedAt: string;
  changedOneThing: string | null;
  note: string | null;
}

interface ProblemResponse {
  type: string;
  status: number;
  detail: string;
  errors: { field: string; code: string }[];
}

function get(url: string, user: TestUser | null) {
  return app.inject({ method: "GET", url, headers: user ? bearer(user) : {} });
}

function put(url: string, user: TestUser | null, payload: object) {
  return app.inject({ method: "PUT", url, headers: user ? bearer(user) : {}, payload });
}

function post(url: string, user: TestUser | null, payload?: object) {
  const headers = user ? bearer(user) : {};
  return payload === undefined
    ? app.inject({ method: "POST", url, headers })
    : app.inject({ method: "POST", url, headers, payload });
}

async function planWeek(
  user: TestUser,
  weekStart: string,
  allocations: object[],
): Promise<PlanResponse> {
  const response = await put(`/v1/plans/${weekStart}`, user, { allocations });
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as PlanResponse;
}

async function readPlan(user: TestUser, weekStart: string): Promise<PlanResponse> {
  const response = await get(`/v1/plans/${weekStart}`, user);
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as PlanResponse;
}

async function readActual(user: TestUser, weekStart: string): Promise<ActualResponse> {
  const response = await get(`/v1/plans/${weekStart}/actual`, user);
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as ActualResponse;
}

async function aMission(user: TestUser, topic: string): Promise<string> {
  const response = await post("/v1/missions", user, { topic });
  expect(response.statusCode, response.body).toBe(201);
  return (JSON.parse(response.body) as { id: string }).id;
}

async function aSkill(user: TestUser, name: string): Promise<string> {
  const response = await post("/v1/skills", user, { name });
  expect(response.statusCode, response.body).toBe(201);
  return (JSON.parse(response.body) as { id: string }).id;
}

async function park(user: TestUser, missionId: string): Promise<void> {
  const response = await post(`/v1/missions/${missionId}/park`, user);
  expect(response.statusCode, response.body).toBe(201);
}

/** A finished session on a mission, through the real endpoint. */
async function aSession(
  user: TestUser,
  missionId: string,
  startedAt: string,
  minutes: number,
): Promise<void> {
  const response = await post("/v1/focus/sessions", user, {
    missionId,
    startedAt,
    endedAt: new Date(new Date(startedAt).getTime() + minutes * 60_000).toISOString(),
    entryMode: "manual",
  });
  expect(response.statusCode, response.body).toBe(201);
}

/**
 * A session carrying a skill, written straight through the admin connection.
 *
 * `focus_sessions.skill_id` was added in M2 for exactly this feature — a skill allocation with no
 * actual to compare against is a plan that cannot be reviewed — but nothing writes it yet: the focus
 * module's schema, entity and repository still stop at mission and resource. Fixturing it here rather
 * than waiting keeps this suite honest about what the *planning* code does with the column, and the
 * day the capture path sets it these tests need no change.
 */
async function aRawSession(
  userId: string,
  session: {
    skillId: string | null;
    missionId: string | null;
    startedAt: string;
    seconds: number;
  },
): Promise<void> {
  const endedAt = new Date(
    new Date(session.startedAt).getTime() + session.seconds * 1_000,
  ).toISOString();

  await db.$executeRawUnsafe(
    `insert into focus_sessions (id, user_id, skill_id, mission_id, started_at, ended_at, entry_mode)
          values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5::timestamptz, 'manual')`,
    userId,
    session.skillId,
    session.missionId,
    session.startedAt,
    endedAt,
  );
}

async function planRowCount(userId: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
    `select count(*) as count from weekly_plans where user_id = $1::uuid`,
    userId,
  );
  return Number(rows[0]?.count ?? 0);
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
  // Allocations cascade from plans, missions and skills; sessions do not, so they go explicitly.
  await db.$executeRawUnsafe(`delete from weekly_plans where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from weekly_reviews where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from focus_sessions where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from missions where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from skills where user_id = any($1::uuid[])`, ids);
  // A known starting point, since individual tests move the timezone and the week start about.
  await Promise.all([
    setProfile(db, alice.id, { timezone: "UTC", weekStartsOn: 1 }),
    setProfile(db, bob.id, { timezone: "UTC", weekStartsOn: 1 }),
  ]);
});

describe("GET /plans/:weekStart", () => {
  it("answers an unplanned week with an empty week rather than a 404", async () => {
    // "You have not planned this week" is a normal state, not a missing resource — a 404 would put an
    // error on the screen whose whole job is to let you plan.
    const plan = await readPlan(alice, MONDAY);

    expect(plan).toEqual({ weekStart: MONDAY, allocations: [], plannedTotal: 0 });
  });

  it("refuses a weekStart that is not a date", async () => {
    // Without the pipe this reaches Postgres and returns a 500 from a cast error.
    expect((await get("/v1/plans/not-a-date", alice)).statusCode).toBe(422);
    // Shaped like a date but not a real one.
    expect((await get("/v1/plans/2026-02-30", alice)).statusCode).toBe(422);
  });
});

describe("PUT /plans/:weekStart (FR-F5)", () => {
  it("round-trips a week through a date column and a nullable-subject table", async () => {
    const mission = await aMission(alice, "Learn Rust");
    const skill = await aSkill(alice, "Ownership");

    const saved = await planWeek(alice, MONDAY, [
      { missionId: mission, plannedMinutes: 300 },
      { skillId: skill, plannedMinutes: 120 },
    ]);

    expect(saved.weekStart).toBe(MONDAY);
    expect(saved.plannedTotal).toBe(420);

    // Read back through a second request, which is what proves the `date` column survived.
    const reread = await readPlan(alice, MONDAY);
    expect(reread.allocations).toEqual([
      { missionId: mission, skillId: null, plannedMinutes: 300 },
      { missionId: null, skillId: skill, plannedMinutes: 120 },
    ]);
  });

  it("replaces the whole week rather than merging into it", async () => {
    const mission = await aMission(alice, "Learn Rust");
    const skill = await aSkill(alice, "Ownership");

    await planWeek(alice, MONDAY, [
      { missionId: mission, plannedMinutes: 300 },
      { skillId: skill, plannedMinutes: 120 },
    ]);
    const replaced = await planWeek(alice, MONDAY, [{ skillId: skill, plannedMinutes: 60 }]);

    expect(replaced.allocations).toEqual([{ missionId: null, skillId: skill, plannedMinutes: 60 }]);
    expect(await readPlan(alice, MONDAY)).toMatchObject({ plannedTotal: 60 });
  });

  it("empties a week", async () => {
    const mission = await aMission(alice, "Learn Rust");
    await planWeek(alice, MONDAY, [{ missionId: mission, plannedMinutes: 300 }]);

    expect(await planWeek(alice, MONDAY, [])).toEqual({
      weekStart: MONDAY,
      allocations: [],
      plannedTotal: 0,
    });
  });

  it("normalises a mid-week date instead of forking a second week", async () => {
    // The failure this prevents is a `weekly_plans` row starting on a Wednesday, which the grid could
    // never find again — and which the unique index on (user_id, week_start) would happily allow.
    const mission = await aMission(alice, "Learn Rust");

    await planWeek(alice, MONDAY, [{ missionId: mission, plannedMinutes: 300 }]);
    const midweek = await planWeek(alice, WEDNESDAY, [{ missionId: mission, plannedMinutes: 60 }]);

    expect(midweek.weekStart).toBe(MONDAY);
    expect(await planRowCount(alice.id)).toBe(1);
    expect(await readPlan(alice, MONDAY)).toMatchObject({ plannedTotal: 60 });
  });

  it("honours a Sunday week start (FR-L5)", async () => {
    await setProfile(db, alice.id, { weekStartsOn: 0 });
    const mission = await aMission(alice, "Learn Rust");

    const saved = await planWeek(alice, WEDNESDAY, [{ missionId: mission, plannedMinutes: 300 }]);

    expect(saved.weekStart).toBe(SUNDAY);
    // And the same profile reads it back from the Sunday.
    expect(await readPlan(alice, SUNDAY)).toMatchObject({ plannedTotal: 300 });
  });

  it("refuses a mission that does not exist, with a 404 rather than a foreign-key 500", async () => {
    const response = await put(`/v1/plans/${MONDAY}`, alice, {
      allocations: [{ missionId: "99999999-9999-4999-8999-999999999999", plannedMinutes: 60 }],
    });

    expect(response.statusCode, response.body).toBe(404);
    const problem = JSON.parse(response.body) as ProblemResponse;
    expect(problem.type).toBe("https://mindforge.app/errors/plan-subject-missing");
  });

  it("refuses a parked mission with a conflict (§5.3)", async () => {
    const mission = await aMission(alice, "Kubernetes");
    await park(alice, mission);

    const response = await put(`/v1/plans/${MONDAY}`, alice, {
      allocations: [{ missionId: mission, plannedMinutes: 60 }],
    });

    expect(response.statusCode, response.body).toBe(409);
    expect((JSON.parse(response.body) as ProblemResponse).type).toBe(
      "https://mindforge.app/errors/mission-parked",
    );
  });

  it("refuses the same subject twice before the partial unique index does", async () => {
    // Left to Postgres this is a driver error and therefore a 500 about a grid the user filled in.
    const mission = await aMission(alice, "Learn Rust");

    const response = await put(`/v1/plans/${MONDAY}`, alice, {
      allocations: [
        { missionId: mission, plannedMinutes: 300 },
        { missionId: mission, plannedMinutes: 60 },
      ],
    });

    expect(response.statusCode, response.body).toBe(422);
    const problem = JSON.parse(response.body) as ProblemResponse;
    expect(problem.type).toBe("https://mindforge.app/errors/duplicate-plan-subject");
    expect(problem.errors.map((e) => e.field)).toEqual(["allocations"]);
  });

  it("refuses an allocation that names both a mission and a skill", async () => {
    const mission = await aMission(alice, "Learn Rust");
    const skill = await aSkill(alice, "Ownership");

    const response = await put(`/v1/plans/${MONDAY}`, alice, {
      allocations: [{ missionId: mission, skillId: skill, plannedMinutes: 60 }],
    });

    expect(response.statusCode, response.body).toBe(422);
  });

  it("refuses zero minutes, which is the absence of an allocation rather than one", async () => {
    const mission = await aMission(alice, "Learn Rust");

    const response = await put(`/v1/plans/${MONDAY}`, alice, {
      allocations: [{ missionId: mission, plannedMinutes: 0 }],
    });

    expect(response.statusCode, response.body).toBe(422);
  });

  it("writes nothing when one allocation in the set is bad", async () => {
    const mission = await aMission(alice, "Learn Rust");
    await planWeek(alice, MONDAY, [{ missionId: mission, plannedMinutes: 300 }]);

    const response = await put(`/v1/plans/${MONDAY}`, alice, {
      allocations: [
        { missionId: mission, plannedMinutes: 60 },
        { missionId: "99999999-9999-4999-8999-999999999999", plannedMinutes: 60 },
      ],
    });
    expect(response.statusCode).toBe(404);

    // The week the user had is untouched — a half-applied set would be a week nobody intended.
    expect(await readPlan(alice, MONDAY)).toMatchObject({ plannedTotal: 300 });
  });
});

describe("GET /plans/:weekStart/actual (FR-F5)", () => {
  it("puts the minutes you spent beside the ones you planned, with the subject's name", async () => {
    const mission = await aMission(alice, "Learn Rust");
    await planWeek(alice, MONDAY, [{ missionId: mission, plannedMinutes: 300 }]);
    await aSession(alice, mission, "2026-08-04T09:00:00Z", 120);

    const actual = await readActual(alice, MONDAY);

    expect(actual.rows).toEqual([
      {
        subject: { kind: "mission", id: mission },
        label: "Learn Rust",
        plannedMinutes: 300,
        actualMinutes: 120,
        deltaMinutes: -180,
        attainment: 0.4,
      },
    ]);
    expect(actual.actualTotal).toBe(120);
  });

  it("sums several sessions the way elapsedMinutes rounds a single one", async () => {
    // Floored per session in SQL, not once over the total: two 89-second blocks are one minute each,
    // and the session list on the Today screen says the same. Summed first they would be three.
    const mission = await aMission(alice, "Learn Rust");
    const at = (startedAt: string) =>
      aRawSession(alice.id, { skillId: null, missionId: mission, startedAt, seconds: 89 });

    await at("2026-08-04T09:00:00Z");
    await at("2026-08-04T11:00:00Z");

    expect((await readActual(alice, MONDAY)).actualTotal).toBe(2);
  });

  it("buckets the week in the caller's timezone, not in UTC", async () => {
    // São Paulo is UTC−3, so the week runs [Mon 03:00Z, next Mon 03:00Z). A session at 02:00Z on the
    // Monday is Sunday 23:00 locally — last week's work, and counting it would make every Monday
    // review start with an hour it did not do.
    await setProfile(db, alice.id, { timezone: "America/Sao_Paulo" });
    const mission = await aMission(alice, "Learn Rust");

    await aSession(alice, mission, "2026-08-03T02:00:00Z", 60);
    await aSession(alice, mission, "2026-08-03T04:00:00Z", 45);

    expect((await readActual(alice, MONDAY)).actualTotal).toBe(45);

    // The same rows, read by a UTC profile, are both inside the week.
    await setProfile(db, alice.id, { timezone: "UTC" });
    expect((await readActual(alice, MONDAY)).actualTotal).toBe(105);
  });

  it("counts a session that names both a mission and a skill exactly once", async () => {
    // One block of time is one block of time. Counting it on both rows would make the week's total
    // exceed the hours worked and inflate its attainment.
    const mission = await aMission(alice, "Learn Rust");
    const skill = await aSkill(alice, "Ownership");
    await aRawSession(alice.id, {
      skillId: skill,
      missionId: mission,
      startedAt: "2026-08-04T09:00:00Z",
      seconds: 60 * 60,
    });

    const actual = await readActual(alice, MONDAY);

    expect(actual.actualTotal).toBe(60);
    expect(actual.rows.map((row) => row.subject)).toEqual([{ kind: "mission", id: mission }]);
  });

  it("measures a skill allocation against the sessions filed under that skill", async () => {
    const skill = await aSkill(alice, "Ownership");
    await planWeek(alice, MONDAY, [{ skillId: skill, plannedMinutes: 120 }]);
    await aRawSession(alice.id, {
      skillId: skill,
      missionId: null,
      startedAt: "2026-08-05T20:00:00Z",
      seconds: 90 * 60,
    });

    expect((await readActual(alice, MONDAY)).rows).toEqual([
      {
        subject: { kind: "skill", id: skill },
        label: "Ownership",
        plannedMinutes: 120,
        actualMinutes: 90,
        deltaMinutes: -30,
        attainment: 0.75,
      },
    ]);
  });

  it("gives work you never planned no attainment at all", async () => {
    const mission = await aMission(alice, "Learn Rust");
    await aSession(alice, mission, "2026-08-04T09:00:00Z", 30);

    const actual = await readActual(alice, MONDAY);

    expect(actual.rows[0]).toMatchObject({
      plannedMinutes: null,
      actualMinutes: 30,
      attainment: null,
    });
    expect(actual.unplannedMinutes).toBe(30);
    expect(actual.attainment).toBeNull();
  });

  it("reports a planned subject with nothing done as zero, which is a measurement", async () => {
    const mission = await aMission(alice, "Learn Rust");
    await planWeek(alice, MONDAY, [{ missionId: mission, plannedMinutes: 300 }]);

    expect((await readActual(alice, MONDAY)).rows[0]).toMatchObject({
      actualMinutes: 0,
      attainment: 0,
    });
  });

  it("drops a mission parked after the week was planned, from both sides (§5.3)", async () => {
    const rust = await aMission(alice, "Learn Rust");
    const k8s = await aMission(alice, "Kubernetes");
    await planWeek(alice, MONDAY, [
      { missionId: rust, plannedMinutes: 300 },
      { missionId: k8s, plannedMinutes: 600 },
    ]);
    await aSession(alice, rust, "2026-08-04T09:00:00Z", 120);
    await aSession(alice, k8s, "2026-08-05T09:00:00Z", 90);

    await park(alice, k8s);
    const actual = await readActual(alice, MONDAY);

    expect(actual.rows.map((row) => row.subject.id)).toEqual([rust]);
    expect(actual.plannedTotal).toBe(300);
    expect(actual.actualTotal).toBe(120);
  });

  it("ignores a session that is still running", async () => {
    // A session with no end has no duration; counting its elapsed time would make the week advance
    // while you sit still.
    const mission = await aMission(alice, "Learn Rust");
    const started = await post("/v1/focus/sessions/start", alice, { missionId: mission });
    expect(started.statusCode, started.body).toBe(201);

    expect((await readActual(alice, MONDAY)).rows).toEqual([]);
  });

  it("answers a week with nothing in it with nothing, rather than with zeroes", async () => {
    const actual = await readActual(alice, MONDAY);

    expect(actual).toEqual({
      weekStart: MONDAY,
      rows: [],
      plannedTotal: 0,
      actualTotal: 0,
      unplannedMinutes: 0,
      attainment: null,
    });
  });

  it("normalises a mid-week date like the other two routes", async () => {
    expect((await readActual(alice, WEDNESDAY)).weekStart).toBe(MONDAY);
  });
});

describe("weekly reviews (FR-F6)", () => {
  it("records the ritual against the normalised week", async () => {
    const response = await post(`/v1/reviews/weekly/${WEDNESDAY}`, alice, {
      changedOneThing: "Two focus blocks before lunch instead of four after it",
    });

    expect(response.statusCode, response.body).toBe(201);
    const review = JSON.parse(response.body) as ReviewResponse;
    expect(review.weekStart).toBe(MONDAY);
    expect(review.changedOneThing).toBe("Two focus blocks before lunch instead of four after it");
  });

  it("accepts a review that changed nothing", async () => {
    // Forcing a sentence produces a fabricated one (§7.2), so the column stays nullable.
    const response = await post(`/v1/reviews/weekly/${MONDAY}`, alice, {});

    expect(response.statusCode, response.body).toBe(201);
    expect((JSON.parse(response.body) as ReviewResponse).changedOneThing).toBeNull();
  });

  it("revises rather than conflicting, and keeps when the ritual happened", async () => {
    const first = JSON.parse(
      (await post(`/v1/reviews/weekly/${MONDAY}`, alice, { changedOneThing: "first thought" }))
        .body,
    ) as ReviewResponse;

    const revised = await post(`/v1/reviews/weekly/${MONDAY}`, alice, {
      changedOneThing: "on reflection",
      note: "the mornings were the difference",
    });
    expect(revised.statusCode, revised.body).toBe(201);

    const body = JSON.parse(revised.body) as ReviewResponse;
    expect(body.changedOneThing).toBe("on reflection");
    expect(body.note).toBe("the mornings were the difference");
    // Same row, and the same moment: a Wednesday correction must not restamp Sunday's review.
    expect(body.id).toBe(first.id);
    expect(body.completedAt).toBe(first.completedAt);

    const listed = JSON.parse((await get("/v1/reviews/weekly", alice)).body) as {
      reviews: ReviewResponse[];
    };
    expect(listed.reviews).toHaveLength(1);
  });

  it("lists the newest week first", async () => {
    await post("/v1/reviews/weekly/2026-07-20", alice, {});
    await post("/v1/reviews/weekly/2026-08-03", alice, {});
    await post("/v1/reviews/weekly/2026-07-27", alice, {});

    const listed = JSON.parse((await get("/v1/reviews/weekly", alice)).body) as {
      reviews: ReviewResponse[];
    };
    expect(listed.reviews.map((review) => review.weekStart)).toEqual([
      "2026-08-03",
      "2026-07-27",
      "2026-07-20",
    ]);
  });

  it("refuses a weekStart that is not a date", async () => {
    expect((await post("/v1/reviews/weekly/last-week", alice, {})).statusCode).toBe(422);
  });
});

describe("isolation", () => {
  it("keeps one person's week out of another's", async () => {
    const bobsMission = await aMission(bob, "Bob's mission");
    await planWeek(bob, MONDAY, [{ missionId: bobsMission, plannedMinutes: 300 }]);
    await aSession(bob, bobsMission, "2026-08-04T09:00:00Z", 120);
    await post(`/v1/reviews/weekly/${MONDAY}`, bob, { changedOneThing: "bob's one thing" });

    // Alice sees the same week as unplanned, unworked, and unreviewed.
    expect(await readPlan(alice, MONDAY)).toEqual({
      weekStart: MONDAY,
      allocations: [],
      plannedTotal: 0,
    });
    expect(await readActual(alice, MONDAY)).toMatchObject({ rows: [], actualTotal: 0 });
    expect(
      (JSON.parse((await get("/v1/reviews/weekly", alice)).body) as { reviews: ReviewResponse[] })
        .reviews,
    ).toEqual([]);
  });

  it("cannot plan against another user's mission", async () => {
    const bobsMission = await aMission(bob, "Bob's mission");

    const response = await put(`/v1/plans/${MONDAY}`, alice, {
      allocations: [{ missionId: bobsMission, plannedMinutes: 60 }],
    });

    // 404, not 403: under RLS "not yours" and "does not exist" are the same answer, and it is the
    // only one Alice is entitled to.
    expect(response.statusCode, response.body).toBe(404);
  });

  it("cannot overwrite another user's week by planning the same one", async () => {
    const bobsMission = await aMission(bob, "Bob's mission");
    const alicesMission = await aMission(alice, "Alice's mission");
    await planWeek(bob, MONDAY, [{ missionId: bobsMission, plannedMinutes: 300 }]);

    await planWeek(alice, MONDAY, [{ missionId: alicesMission, plannedMinutes: 60 }]);

    // Two rows for the same week, one each — and Bob's is untouched.
    expect(await planRowCount(bob.id)).toBe(1);
    expect(await readPlan(bob, MONDAY)).toMatchObject({ plannedTotal: 300 });
  });

  it("cannot revise another user's review", async () => {
    await post(`/v1/reviews/weekly/${MONDAY}`, bob, { changedOneThing: "bob's one thing" });

    const response = await post(`/v1/reviews/weekly/${MONDAY}`, alice, {
      changedOneThing: "hijacked",
    });
    expect(response.statusCode, response.body).toBe(201);

    // Alice got her own row; Bob's still says what he wrote.
    const bobs = await db.$queryRawUnsafe<{ changed_one_thing: string }[]>(
      `select changed_one_thing from weekly_reviews where user_id = $1::uuid`,
      bob.id,
    );
    expect(bobs.map((row) => row.changed_one_thing)).toEqual(["bob's one thing"]);
  });

  it("requires a token", async () => {
    expect((await get(`/v1/plans/${MONDAY}`, null)).statusCode).toBe(401);
    expect((await put(`/v1/plans/${MONDAY}`, null, { allocations: [] })).statusCode).toBe(401);
    expect((await get(`/v1/plans/${MONDAY}/actual`, null)).statusCode).toBe(401);
    expect((await post(`/v1/reviews/weekly/${MONDAY}`, null, {})).statusCode).toBe(401);
    expect((await get("/v1/reviews/weekly", null)).statusCode).toBe(401);
  });
});

describe("a review is not lost to a capped list or a double tap", () => {
  it("finds a review far older than the list's cap", async () => {
    // The SPA used to find `existing` by scanning `GET /reviews/weekly`, capped at 52 — so any week
    // older than the newest 52 rendered a blank form labelled "Complete", and submitting it
    // overwrote the stored sentence through an endpoint that is idempotent by design.
    const ancient = "2024-01-01";
    await post(`/v1/reviews/weekly/${ancient}`, alice, { changedOneThing: "Mornings only" });

    // Enough newer reviews to push it past the cap. Seven days apart, because the endpoint
    // normalises whatever it is given to that week's start — dates a day apart would collapse onto
    // the same handful of weeks and never reach 52.
    const firstMonday = Date.UTC(2025, 0, 6);
    for (let week = 0; week < 55; week += 1) {
      const weekStart = new Date(firstMonday + week * 7 * 86_400_000).toISOString().slice(0, 10);
      await post(`/v1/reviews/weekly/${weekStart}`, alice, { changedOneThing: `week ${week}` });
    }

    const listed = JSON.parse((await get("/v1/reviews/weekly", alice)).body) as {
      reviews: { weekStart: string }[];
    };
    expect(listed.reviews.some((r) => r.weekStart === ancient)).toBe(false);

    // And asked for directly, it is right there.
    const one = JSON.parse((await get(`/v1/reviews/weekly/${ancient}`, alice)).body) as {
      review: { changedOneThing: string | null } | null;
    };
    expect(one.review?.changedOneThing).toBe("Mornings only");
  });

  it("answers null for a week never reviewed, rather than 404", async () => {
    // "You have not reviewed this week" is a normal state, exactly as it is for a plan.
    const response = await get("/v1/reviews/weekly/2023-05-01", alice);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ review: null });
  });

  it("survives two plan saves racing, and the allocations land on the surviving row", async () => {
    // Same read-then-write shape one level up: both saves read no plan for the week, both mint an id,
    // and the loser hit the unique index. Fixing it by upserting on `(user, week)` is only half —
    // the allocations must go on the id the upsert actually landed on, or the caller's unused id
    // violates the foreign key and one 500 becomes another.
    const mission = await aMission(alice, "Raced");
    const week = "2026-04-13";
    const body = { allocations: [{ missionId: mission, plannedMinutes: 120 }] };

    const responses = await Promise.all([
      put(`/v1/plans/${week}`, alice, body),
      put(`/v1/plans/${week}`, alice, body),
    ]);
    for (const response of responses) {
      expect(response.statusCode, response.body).toBeLessThan(400);
    }

    const plan = JSON.parse((await get(`/v1/plans/${week}`, alice)).body) as {
      allocations: unknown[];
      plannedTotal: number;
    };
    expect(plan.allocations).toHaveLength(1);
    expect(plan.plannedTotal).toBe(120);
  });

  it("survives two submissions racing, rather than 500ing on the loser", async () => {
    // It was `findFirst` then `create`: both callers see nothing, both insert, and the loser raises
    // P2002 — not a `DomainError`, so the problem filter turns it into a 500 on the endpoint
    // documented as idempotent. A double-tap on Complete, or a queue replay, was enough.
    const week = "2026-04-06";
    const responses = await Promise.all([
      post(`/v1/reviews/weekly/${week}`, alice, { changedOneThing: "first" }),
      post(`/v1/reviews/weekly/${week}`, alice, { changedOneThing: "second" }),
    ]);

    for (const response of responses) {
      expect(response.statusCode, response.body).toBeLessThan(400);
    }

    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from weekly_reviews where user_id = $1::uuid and week_start = $2::date`,
      alice.id,
      week,
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});
