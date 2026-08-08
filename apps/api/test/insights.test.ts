import type { PrismaClient } from "@mindforge/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InsightsModule } from "../src/modules/insights/presentation/insights.module.js";
import { SharedModule } from "../src/shared/shared.module.js";
import {
  adminDb,
  bearer,
  bootApp,
  deleteUsers,
  setProfile,
  signUp,
  type TestUser,
} from "./support/stack.js";

// TEMPORARY probe boot — replaced with bootApp() before hand-off.
async function bootProbe(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [SharedModule, InsightsModule],
  }).compile();
  const probe = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  probe.setGlobalPrefix("v1");
  probe.enableCors({
    origin: "http://localhost:5173",
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["authorization", "content-type", "if-none-match"],
    exposedHeaders: ["etag"],
  });
  await probe.init();
  await probe.getHttpAdapter().getInstance().ready();
  return probe;
}
void bootApp;

/**
 * The insights dashboard end to end (FR-I6b, FR-I7, §3.9, §6.1).
 *
 * Four things here are only observable at this level. The grid reads `daily_activity` and nothing
 * else, so the rows have to be real ones written to a real `date` column — a mapper that lost a day
 * to a timezone offset type-checks perfectly. The backlog's last-touch is a **grouped max** across
 * a join, which is SQL rather than logic. The friction cross-tab is raw SQL over three tables with
 * two LEFT joins, and whether those joins drop a standalone tap is a fact about Postgres. And
 * `ETag`/`If-None-Match` is an HTTP conversation that no unit test has a client for.
 *
 * **Dates come from the database, not from the clock.** The API buckets "today" with `SystemClock`,
 * so anything the window depends on is seeded as `now() - make_interval(...)` and asserted in
 * relative days. The activity grid takes explicit bounds, so that half of the suite pins fixed
 * dates and is immune to when it runs.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;

const ORIGIN = "http://localhost:5173";

/** A Monday, and 28 days to the Sunday that closes the window. */
const GRID_FROM = "2026-06-01";
const GRID_TO = "2026-06-28";
const GRID_URL = `/v1/insights/activity?from=${GRID_FROM}&to=${GRID_TO}`;
/** The Monday of the last week in that window — the only week a plan can be "in force" for. */
const LAST_WEEK_START = "2026-06-22";
const REBUILT_AT = "2026-06-29T03:00:00Z";

interface GridCell {
  day: string;
  value: number;
  intensity: number;
  emberShare: number | null;
}

interface GridResponse {
  from: string;
  to: string;
  layer: string;
  cells: GridCell[];
  activeDaysIn28: number;
  signal: { kind: string; averageActiveDays?: number; plannedDays?: number } | null;
  rebuiltAt: string | null;
}

interface BacklogResponse {
  windowDays: number;
  added: number;
  resolved: number;
  netChange: number;
  openCount: number;
  oldestOpenDays: number | null;
  medianOpenAgeDays: number | null;
  stalled: { id: string; untouchedDays: number; lastTouchedOn: string | null }[];
  abandoned: number;
  finished: number;
  abandonmentRate: number | null;
  abandonReasons: { reason: string; count: number }[];
  abandonment: { total: number; reasons: { reason: string; count: number }[] };
  signal: { kind: string } | null;
}

interface FrictionResponse {
  eventCount: number;
  byType: { type: string; count: number; meanIntensity: number }[];
  byMission: { missionId: string; topic: string; count: number }[];
  unattributed: { total: number; standalone: number; sessionWithoutMission: number };
}

function get(url: string, user: TestUser | null, headers: Record<string, string> = {}) {
  return app.inject({
    method: "GET",
    url,
    headers: { ...(user ? bearer(user) : {}), ...headers },
  });
}

async function gridOf(user: TestUser, url = GRID_URL): Promise<GridResponse> {
  const response = await get(url, user);
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as GridResponse;
}

async function backlogOf(user: TestUser, windowDays?: number): Promise<BacklogResponse> {
  const query = windowDays === undefined ? "" : `?windowDays=${windowDays}`;
  const response = await get(`/v1/insights/backlog${query}`, user);
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as BacklogResponse;
}

async function frictionOf(user: TestUser, query = ""): Promise<FrictionResponse> {
  const response = await get(`/v1/insights/friction${query}`, user);
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as FrictionResponse;
}

// --- Fixtures, written straight through the admin connection -----------------
//
// The rollup, the planner and the timer are all things under test elsewhere; reaching for their
// endpoints here would make an insights failure look like a capture failure.

async function seedDay(
  user: TestUser,
  day: string,
  activity: { focusMinutes?: number; ember?: number; slag?: number; notes?: number } = {},
): Promise<void> {
  await db.$executeRawUnsafe(
    `insert into daily_activity
       (user_id, day, focus_minutes, session_count, ember_minutes, slag_minutes, notes_captured, resources_touched, rebuilt_at)
     values ($1::uuid, $2::date, $3, 1, $4, $5, $6, 0, $7::timestamptz)`,
    user.id,
    day,
    activity.focusMinutes ?? 0,
    activity.ember ?? 0,
    activity.slag ?? 0,
    activity.notes ?? 0,
    REBUILT_AT,
  );
}

async function seedMission(user: TestUser, topic: string): Promise<string> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, updated_at)
     values (gen_random_uuid(), $1::uuid, $2, now())
     returning id`,
    user.id,
    topic,
  );
  return rows[0]!.id;
}

async function seedPlan(user: TestUser, weekStart: string, minutes: number): Promise<void> {
  const missionId = await seedMission(user, `Planned ${weekStart}`);
  const plans = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into weekly_plans (id, user_id, week_start, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::date, now())
     returning id`,
    user.id,
    weekStart,
  );
  await db.$executeRawUnsafe(
    `insert into weekly_allocations (id, user_id, plan_id, mission_id, planned_minutes)
     values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4)`,
    user.id,
    plans[0]!.id,
    missionId,
    minutes,
  );
}

async function seedResource(
  user: TestUser,
  resource: {
    title: string;
    status: string;
    addedDaysAgo: number;
    finishedDaysAgo?: number;
    abandonReason?: string;
  },
): Promise<string> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into resources (id, user_id, type, title, status, abandon_reason, added_at, finished_at)
     values (gen_random_uuid(), $1::uuid, 'book', $2, $3, $4,
             now() - make_interval(days => $5::int),
             case when $6::int is null then null else now() - make_interval(days => $6::int) end)
     returning id`,
    user.id,
    resource.title,
    resource.status,
    resource.abandonReason ?? null,
    resource.addedDaysAgo,
    resource.finishedDaysAgo ?? null,
  );
  return rows[0]!.id;
}

/** A finished 30-minute block, `daysAgo` days back. */
async function seedSession(
  user: TestUser,
  session: { daysAgo: number; missionId?: string | null; resourceId?: string | null },
): Promise<string> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into focus_sessions
       (id, user_id, mission_id, resource_id, started_at, ended_at, hit_intention, entry_mode)
     values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid,
             now() - make_interval(days => $4::int),
             now() - make_interval(days => $4::int) + interval '30 minutes',
             'yes', 'manual')
     returning id`,
    user.id,
    session.missionId ?? null,
    session.resourceId ?? null,
    session.daysAgo,
  );
  return rows[0]!.id;
}

async function seedFriction(
  user: TestUser,
  event: { type: string; intensity: number; sessionId?: string | null },
): Promise<void> {
  await db.$executeRawUnsafe(
    `insert into friction_events (id, user_id, session_id, type, intensity, occurred_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, now())`,
    user.id,
    event.sessionId ?? null,
    event.type,
    event.intensity,
  );
}

beforeAll(async () => {
  db = adminDb();
  app = await bootProbe();
  [alice, bob] = await Promise.all([signUp(), signUp()]);
  // Explicit rather than relying on the signup default: every assertion below about which day a
  // thing landed on is a statement about this setting.
  await Promise.all([
    setProfile(db, alice.id, { timezone: "UTC", weekStartsOn: 1 }),
    setProfile(db, bob.id, { timezone: "UTC", weekStartsOn: 1 }),
  ]);
});

afterAll(async () => {
  await deleteUsers(db, [alice.id, bob.id].filter(Boolean));
  await db.$disconnect();
  await app.close();
});

beforeEach(async () => {
  const ids = [alice.id, bob.id];
  for (const table of [
    "friction_events",
    "focus_sessions",
    "weekly_allocations",
    "weekly_plans",
    "missions",
    "resources",
    "daily_activity",
  ]) {
    await db.$executeRawUnsafe(`delete from ${table} where user_id = any($1::uuid[])`, ids);
  }
});

describe("the activity grid (FR-I6b, §3.9)", () => {
  it("draws one cell per day in the range, empty days included", async () => {
    await seedDay(alice, "2026-06-10", { focusMinutes: 90, ember: 20, slag: 5 });

    const grid = await gridOf(alice);

    expect(grid.cells).toHaveLength(28);
    expect(grid.cells[0]).toMatchObject({ day: GRID_FROM, value: 0, intensity: 0 });
    expect(grid.cells.at(-1)?.day).toBe(GRID_TO);
    // Intensity 1, not 4: the steps are quartiles of your *own* non-empty days, and one day is its
    // own whole distribution. An absolute scale would render a modest year as uniformly pale.
    expect(grid.cells[9]).toMatchObject({ day: "2026-06-10", value: 90, intensity: 1 });
    expect(grid.activeDaysIn28).toBe(1);
  });

  it("shades a day against your own history rather than an absolute scale", async () => {
    for (const [day, minutes] of [
      ["2026-06-02", 15],
      ["2026-06-03", 30],
      ["2026-06-04", 45],
      ["2026-06-05", 120],
    ] as const) {
      await seedDay(alice, day, { focusMinutes: minutes });
    }

    const byDay = new Map((await gridOf(alice)).cells.map((cell) => [cell.day, cell.intensity]));

    expect([...byDay].filter(([, intensity]) => intensity > 0)).toEqual([
      ["2026-06-02", 1],
      ["2026-06-03", 2],
      ["2026-06-04", 3],
      ["2026-06-05", 4],
    ]);
  });

  it("keeps the day the rollup wrote, rather than shifting it by an offset", async () => {
    // `daily_activity.day` is a bare `date`. Read back through a timezone it does not have, this
    // cell lands on the 9th for everyone west of Greenwich — the single most likely bug in the
    // whole read path, and invisible to a unit test against a fake repository.
    await seedDay(alice, "2026-06-10", { focusMinutes: 30 });

    expect((await gridOf(alice)).cells.filter((cell) => cell.value > 0)).toEqual([
      { day: "2026-06-10", value: 30, intensity: 1, emberShare: null },
    ]);
  });

  it("hues a day by its ember share and leaves an unannotated day neutral", async () => {
    await seedDay(alice, "2026-06-10", { focusMinutes: 60, ember: 30, slag: 10 });
    await seedDay(alice, "2026-06-11", { focusMinutes: 60 });

    const cells = await gridOf(alice).then((grid) => grid.cells);

    expect(cells.find((cell) => cell.day === "2026-06-10")?.emberShare).toBe(0.75);
    // Null, not zero. A day you simply did not annotate has not been measured, and a grey cell
    // would claim it was.
    expect(cells.find((cell) => cell.day === "2026-06-11")?.emberShare).toBeNull();
  });

  it("switches the layer to notes without changing what counts as an active day", async () => {
    await seedDay(alice, "2026-06-10", { focusMinutes: 60, notes: 4 });

    const notes = await gridOf(alice, `${GRID_URL}&layer=notes`);

    expect(notes.layer).toBe("notes");
    expect(notes.cells.find((cell) => cell.day === "2026-06-10")?.value).toBe(4);
    expect(notes.activeDaysIn28).toBe(1);
  });

  it("defaults to focus when no layer is asked for", async () => {
    expect((await gridOf(alice)).layer).toBe("focus");
  });

  it("says when the rollup last wrote this range, and null when it never has", async () => {
    // A stale grid and an empty grid are otherwise the same picture, and the nightly job is the
    // thing most likely to fail quietly.
    expect((await gridOf(alice)).rebuiltAt).toBeNull();

    await seedDay(alice, "2026-06-10", { focusMinutes: 30 });
    expect((await gridOf(alice)).rebuiltAt).toBe("2026-06-29T03:00:00.000Z");
  });

  it("derives the pace line from the plan and your own typical day", async () => {
    // Four days of 75 minutes and a 300-minute plan: the plan assumes four days, and four active
    // days across four weeks is an average of one. Nothing in the schema stores "days per week" —
    // both halves of this sentence are derived from rows the user actually wrote.
    for (const day of ["2026-06-02", "2026-06-09", "2026-06-16", "2026-06-23"]) {
      await seedDay(alice, day, { focusMinutes: 75 });
    }
    await seedPlan(alice, LAST_WEEK_START, 300);

    expect((await gridOf(alice)).signal).toEqual({
      kind: "pace_below_plan",
      averageActiveDays: 1,
      plannedDays: 4,
    });
  });

  it("draws no pace line without a plan, however sparse the month was", async () => {
    for (const day of ["2026-06-02", "2026-06-09", "2026-06-16", "2026-06-23"]) {
      await seedDay(alice, day, { focusMinutes: 75 });
    }

    expect((await gridOf(alice)).signal).toBeNull();
  });

  it("draws no pace line from too few days to have a typical one", async () => {
    await seedDay(alice, "2026-06-23", { focusMinutes: 75 });
    await seedPlan(alice, LAST_WEEK_START, 300);

    expect((await gridOf(alice)).signal).toBeNull();
  });

  it("ignores a plan from outside the four weeks it would be compared against", async () => {
    for (const day of ["2026-06-02", "2026-06-09", "2026-06-16", "2026-06-23"]) {
      await seedDay(alice, day, { focusMinutes: 75 });
    }
    // Two weeks before the window opens. Setting it beside "your last four weeks" would be two
    // different spans in one sentence.
    await seedPlan(alice, "2026-05-18", 300);

    expect((await gridOf(alice)).signal).toBeNull();
  });

  it("refuses a range that runs backwards, or one longer than a year", async () => {
    expect(
      (await get("/v1/insights/activity?from=2026-06-28&to=2026-06-01", alice)).statusCode,
    ).toBe(422);
    expect(
      (await get("/v1/insights/activity?from=2025-01-01&to=2026-12-31", alice)).statusCode,
    ).toBe(422);
  });

  it("refuses a layer that has no source table yet", async () => {
    // §3.9 names five layers and three of them have no rows until M4–M6. A 422 beats a screen of
    // zeroes claiming you completed no reviews.
    expect((await get(`${GRID_URL}&layer=reviews`, alice)).statusCode).toBe(422);
  });

  it("never draws another user's days", async () => {
    await seedDay(bob, "2026-06-10", { focusMinutes: 240 });

    const grid = await gridOf(alice);

    expect(grid.cells.every((cell) => cell.value === 0)).toBe(true);
    expect(grid.activeDaysIn28).toBe(0);
    expect(grid.rebuiltAt).toBeNull();
  });

  it("never reads another user's plan for the pace line", async () => {
    for (const day of ["2026-06-02", "2026-06-09", "2026-06-16", "2026-06-23"]) {
      await seedDay(alice, day, { focusMinutes: 75 });
    }
    await seedPlan(bob, LAST_WEEK_START, 300);

    expect((await gridOf(alice)).signal).toBeNull();
  });
});

describe("backlog health (FR-I7, FR-R6)", () => {
  it("counts what came in, what went out, and what is still open", async () => {
    await seedResource(alice, { title: "queued", status: "queued", addedDaysAgo: 5 });
    await seedResource(alice, { title: "reading", status: "active", addedDaysAgo: 3 });
    await seedResource(alice, {
      title: "done",
      status: "finished",
      addedDaysAgo: 10,
      finishedDaysAgo: 2,
    });
    // A reference is a thing you keep, not a thing you owe yourself.
    await seedResource(alice, { title: "the docs", status: "reference", addedDaysAgo: 4 });

    const backlog = await backlogOf(alice);

    expect(backlog).toMatchObject({
      windowDays: 28,
      added: 4,
      finished: 1,
      resolved: 1,
      netChange: 3,
      openCount: 2,
      oldestOpenDays: 5,
    });
  });

  it("takes the most recent session as the last touch, in one grouped query", async () => {
    const book = await seedResource(alice, {
      title: "half-read",
      status: "active",
      addedDaysAgo: 60,
    });
    await seedSession(alice, { daysAgo: 40, resourceId: book });
    await seedSession(alice, { daysAgo: 25, resourceId: book });

    const backlog = await backlogOf(alice);

    // 25, not 40 and not 60: the max wins over the other session and over the added date.
    expect(backlog.stalled).toHaveLength(1);
    expect(backlog.stalled[0]).toMatchObject({ id: book, untouchedDays: 25 });
    // Asserted for shape rather than value: the exact date depends on when the suite runs, and
    // `expect.any` is typed `any`, which the repo's lint rules refuse.
    expect(backlog.stalled[0]?.lastTouchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("tells never touched apart from touched a long time ago", async () => {
    const untouched = await seedResource(alice, {
      title: "never opened",
      status: "active",
      addedDaysAgo: 90,
    });

    expect((await backlogOf(alice)).stalled).toEqual([
      { id: untouched, untouchedDays: 90, lastTouchedOn: null },
    ]);
  });

  it("leaves a resource you touched this week out of the stalled list", async () => {
    const book = await seedResource(alice, {
      title: "reading",
      status: "active",
      addedDaysAgo: 60,
    });
    await seedSession(alice, { daysAgo: 2, resourceId: book });

    expect((await backlogOf(alice)).stalled).toEqual([]);
  });

  it("reports abandonment as a gap, because the schema cannot date one", async () => {
    // `resources` records that you abandoned something and never when — there is no
    // `abandoned_at`, and `finished_at` is cleared on any transition away from finished. So the
    // windowed figures cannot see these, and publishing "0 abandoned, 0% rate" to someone who quit
    // two books would be a zero claiming to be a measurement.
    await seedResource(alice, {
      title: "quit one",
      status: "abandoned",
      addedDaysAgo: 20,
      abandonReason: "too shallow",
    });
    await seedResource(alice, { title: "quit two", status: "abandoned", addedDaysAgo: 15 });
    await seedResource(alice, {
      title: "done",
      status: "finished",
      addedDaysAgo: 10,
      finishedDaysAgo: 1,
    });

    const backlog = await backlogOf(alice);

    expect(backlog.abandonment).toEqual({
      total: 2,
      reasons: [{ reason: "too shallow", count: 1 }],
    });
    expect(backlog.abandonmentRate).toBeNull();
    // Core's windowed view still reports what it can see, which is none of them.
    expect(backlog.abandoned).toBe(0);
  });

  it("reports a real zero rate when nothing was abandoned at all", async () => {
    await seedResource(alice, {
      title: "done",
      status: "finished",
      addedDaysAgo: 10,
      finishedDaysAgo: 1,
    });

    const backlog = await backlogOf(alice);

    expect(backlog.abandonment).toEqual({ total: 0, reasons: [] });
    expect(backlog.abandonmentRate).toBe(0);
  });

  it("honours a narrower window", async () => {
    await seedResource(alice, { title: "old", status: "queued", addedDaysAgo: 20 });

    expect((await backlogOf(alice, 7)).added).toBe(0);
    // Still open, and still aged from the day it arrived rather than from the window's edge.
    expect((await backlogOf(alice, 7)).oldestOpenDays).toBe(20);
    expect((await backlogOf(alice, 28)).added).toBe(1);
  });

  it("refuses a window shorter than a week", async () => {
    expect((await get("/v1/insights/backlog?windowDays=1", alice)).statusCode).toBe(422);
  });

  it("never counts another user's library, or their sessions as your touches", async () => {
    const bobs = await seedResource(bob, { title: "bob's", status: "active", addedDaysAgo: 40 });
    await seedSession(bob, { daysAgo: 1, resourceId: bobs });
    const mine = await seedResource(alice, {
      title: "mine",
      status: "active",
      addedDaysAgo: 40,
    });

    const backlog = await backlogOf(alice);

    expect(backlog.openCount).toBe(1);
    expect(backlog.stalled.map((row) => row.id)).toEqual([mine]);
  });
});

describe("friction analytics (FR-I6b, §6)", () => {
  /** Three sources of friction: a mission, another mission, and nothing at all. */
  async function seedFrictionHistory(): Promise<{ rust: string; ocaml: string }> {
    const rust = await seedMission(alice, "Rust ownership");
    const ocaml = await seedMission(alice, "OCaml modules");

    const onRust = await seedSession(alice, { daysAgo: 2, missionId: rust });
    const onOcaml = await seedSession(alice, { daysAgo: 3, missionId: ocaml });
    const unfiled = await seedSession(alice, { daysAgo: 4 });

    await seedFriction(alice, { type: "tooling", intensity: 5, sessionId: onRust });
    await seedFriction(alice, { type: "tooling", intensity: 4, sessionId: onRust });
    await seedFriction(alice, { type: "tooling", intensity: 3, sessionId: onRust });
    await seedFriction(alice, { type: "too_hard", intensity: 2, sessionId: onOcaml });
    await seedFriction(alice, { type: "interruption", intensity: 3, sessionId: unfiled });
    // The escape hatch: one tap, no session, no mission.
    await seedFriction(alice, { type: "interruption", intensity: 1 });

    return { rust, ocaml };
  }

  it("counts by type with the mean intensity, ranked by count", async () => {
    await seedFrictionHistory();

    const friction = await frictionOf(alice);

    expect(friction.eventCount).toBe(6);
    expect(friction.byType).toEqual([
      { type: "tooling", count: 3, meanIntensity: 4 },
      { type: "interruption", count: 2, meanIntensity: 2 },
      { type: "too_hard", count: 1, meanIntensity: 2 },
    ]);
  });

  it("attributes friction to the mission through the session it happened in", async () => {
    const { rust, ocaml } = await seedFrictionHistory();

    expect((await frictionOf(alice)).byMission).toEqual([
      { missionId: rust, topic: "Rust ownership", count: 3 },
      { missionId: ocaml, topic: "OCaml modules", count: 1 },
    ]);
  });

  it("reports the friction with no mission rather than dropping it", async () => {
    await seedFrictionHistory();

    // Two LEFT joins, and this is what they are for: an inner join would silently drop both of
    // these and make the totals disagree with /friction/summary for no visible reason.
    expect((await frictionOf(alice)).unattributed).toEqual({
      total: 2,
      standalone: 1,
      sessionWithoutMission: 1,
    });
  });

  it("narrows to one window", async () => {
    await seedFrictionHistory();
    // Everything above was logged at `now()`, so a window opening tomorrow holds none of it.
    const future = "2099-01-01T00:00:00.000Z";

    expect((await frictionOf(alice, `?since=${future}`)).eventCount).toBe(0);
  });

  it("narrows to one mission, which excludes every unattributed tap by construction", async () => {
    const { rust } = await seedFrictionHistory();

    const friction = await frictionOf(alice, `?missionId=${rust}`);

    expect(friction.eventCount).toBe(3);
    expect(friction.byMission).toEqual([{ missionId: rust, topic: "Rust ownership", count: 3 }]);
    expect(friction.unattributed.total).toBe(0);
  });

  it("answers an empty history with zeroes rather than an error", async () => {
    expect(await frictionOf(alice)).toEqual({
      eventCount: 0,
      byType: [],
      byMission: [],
      unattributed: { total: 0, standalone: 0, sessionWithoutMission: 0 },
    });
  });

  it("never counts another user's friction, or names their mission", async () => {
    const bobsMission = await seedMission(bob, "Bob's mission");
    const bobsSession = await seedSession(bob, { daysAgo: 1, missionId: bobsMission });
    await seedFriction(bob, { type: "tooling", intensity: 5, sessionId: bobsSession });

    const friction = await frictionOf(alice);

    expect(friction.eventCount).toBe(0);
    expect(friction.byMission).toEqual([]);
  });

  it("cannot be pointed at another user's mission", async () => {
    const bobsMission = await seedMission(bob, "Bob's mission");
    const bobsSession = await seedSession(bob, { daysAgo: 1, missionId: bobsMission });
    await seedFriction(bob, { type: "tooling", intensity: 5, sessionId: bobsSession });

    // RLS makes it indistinguishable from a mission that never existed, which is the right answer.
    expect((await frictionOf(alice, `?missionId=${bobsMission}`)).eventCount).toBe(0);
  });
});

describe("ETag and If-None-Match (§6.1)", () => {
  it("tags the response and answers a matching tag with 304 and no body", async () => {
    await seedDay(alice, "2026-06-10", { focusMinutes: 90 });

    const first = await get(GRID_URL, alice);
    expect(first.statusCode).toBe(200);

    const etag = String(first.headers["etag"]);
    expect(etag).toMatch(/^".+"$/);
    expect(first.headers["cache-control"]).toBe("private, no-cache");

    const second = await get(GRID_URL, alice, { "if-none-match": etag });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
    // RFC 9110: a 304 carries the validator, so the client's stored copy stays addressable.
    expect(second.headers["etag"]).toBe(etag);
  });

  it("changes the tag when the data changes", async () => {
    await seedDay(alice, "2026-06-10", { focusMinutes: 90 });
    const before = String((await get(GRID_URL, alice)).headers["etag"]);

    await seedDay(alice, "2026-06-11", { focusMinutes: 45 });
    const after = await get(GRID_URL, alice, { "if-none-match": before });

    expect(after.statusCode).toBe(200);
    expect(String(after.headers["etag"])).not.toBe(before);
  });

  it("changes the tag when the query changes, not only when the rollup runs", async () => {
    // The reason the tag is a hash of the body rather than `daily_activity.rebuilt_at`: one rollup
    // timestamp answers every range, so a client that scrolled the grid back a year would be told
    // nothing had changed and would keep drawing the wrong months.
    await seedDay(alice, "2026-06-10", { focusMinutes: 90 });

    const june = String((await get(GRID_URL, alice)).headers["etag"]);
    const may = await get("/v1/insights/activity?from=2026-05-01&to=2026-05-28", alice, {
      "if-none-match": june,
    });

    expect(may.statusCode).toBe(200);
    expect(String(may.headers["etag"])).not.toBe(june);
  });

  it("honours a weakened tag, which is what If-None-Match comparison requires", async () => {
    const etag = String((await get("/v1/insights/backlog", alice)).headers["etag"]);

    const response = await get("/v1/insights/backlog", alice, {
      "if-none-match": `W/${etag}`,
    });

    expect(response.statusCode).toBe(304);
  });

  it("honours a list, and the wildcard", async () => {
    const etag = String((await get("/v1/insights/friction", alice)).headers["etag"]);

    expect(
      (await get("/v1/insights/friction", alice, { "if-none-match": `"stale", ${etag}` }))
        .statusCode,
    ).toBe(304);
    expect((await get("/v1/insights/friction", alice, { "if-none-match": "*" })).statusCode).toBe(
      304,
    );
  });

  it("does not hand one user's tag to another", async () => {
    await seedDay(alice, "2026-06-10", { focusMinutes: 90 });

    const alices = String((await get(GRID_URL, alice)).headers["etag"]);
    const bobs = await get(GRID_URL, bob, { "if-none-match": alices });

    // Bob's grid is empty and Alice's is not, so the tags differ and he gets his own answer. A
    // shared tag here would be a cross-user cache hit.
    expect(bobs.statusCode).toBe(200);
    expect(String(bobs.headers["etag"])).not.toBe(alices);
  });

  it("tags every insight, not only the grid", async () => {
    for (const url of [
      "/v1/insights/activity?from=2026-06-01&to=2026-06-28",
      "/v1/insights/backlog",
      "/v1/insights/friction",
    ]) {
      const response = await get(url, alice);
      expect(response.headers["etag"], url).toBeDefined();
    }
  });
});

describe("CORS for the conditional request", () => {
  /**
   * `app.inject()` is in-process with no browser enforcing anything, so the whole ETag suite above
   * passes with the header disallowed — and then a real browser strips `If-None-Match` at the
   * preflight and the feature never fires once. This is the only level below E2E where that is
   * observable, exactly as `cors.test.ts` argues for the method list.
   */
  function preflight(headers: string) {
    return app.inject({
      method: "OPTIONS",
      url: "/v1/insights/activity",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-headers": headers,
      },
    });
  }

  it("lets the browser send If-None-Match", async () => {
    const response = await preflight("authorization,if-none-match");

    expect(response.statusCode).toBe(204);
    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain(
      "if-none-match",
    );
  });

  it("lets the browser read the ETag back", async () => {
    // Not a CORS-safelisted response header, so `response.headers.get("etag")` is null unless it
    // is exposed — and a client that cannot read the tag has nothing to send next time.
    const response = await preflight("authorization");

    expect(String(response.headers["access-control-expose-headers"]).toLowerCase()).toContain(
      "etag",
    );
  });

  it("exposes it on the real response too, not only on the preflight", async () => {
    const response = await get(GRID_URL, alice, { origin: ORIGIN });

    expect(String(response.headers["access-control-expose-headers"]).toLowerCase()).toContain(
      "etag",
    );
  });
});

describe("auth", () => {
  it("requires a token on every insight", async () => {
    expect((await get(GRID_URL, null)).statusCode).toBe(401);
    expect((await get("/v1/insights/backlog", null)).statusCode).toBe(401);
    expect((await get("/v1/insights/friction", null)).statusCode).toBe(401);
  });
});
