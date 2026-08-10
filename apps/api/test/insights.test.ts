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
 * The frequency tracker end to end (FR-Q1, FR-Q2, §6.1).
 *
 * Two things here are only observable at this level. The grid reads `daily_activity` and nothing
 * else, so the rows have to be real ones written to a real `date` column — a mapper that lost a day
 * to a timezone offset type-checks perfectly. And `ETag`/`If-None-Match` is an HTTP conversation
 * that no unit test has a client for.
 *
 * The grid takes explicit bounds, so the suite pins fixed dates and is immune to when it runs.
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
const REBUILT_AT = "2026-06-29T03:00:00Z";

interface GridCell {
  day: string;
  value: number;
  intensity: number;
}

interface GridResponse {
  from: string;
  to: string;
  cells: GridCell[];
  activeDaysIn28: number;
  signal: { kind: string } | null;
  rebuiltAt: string | null;
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

// --- Fixtures, written straight through the admin connection -----------------
//
// The rollup and the timer are things under test elsewhere; reaching for their
// endpoints here would make an insights failure look like a capture failure.

async function seedDay(
  user: TestUser,
  day: string,
  activity: { focusMinutes?: number } = {},
): Promise<void> {
  await db.$executeRawUnsafe(
    `insert into daily_activity (user_id, day, focus_minutes, session_count, rebuilt_at)
     values ($1::uuid, $2::date, $3, 1, $4::timestamptz)`,
    user.id,
    day,
    activity.focusMinutes ?? 0,
    REBUILT_AT,
  );
}

beforeAll(async () => {
  db = adminDb();
  // The real app, not a probe module with only SharedModule + InsightsModule. The CORS assertions
  // below are the reason it matters: a probe that configured its own `enableCors` would pass them
  // while `bootstrap.ts` — the thing that actually serves requests — said something else entirely.
  app = await bootApp();
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
  for (const table of ["focus_sessions", "missions", "daily_activity"]) {
    await db.$executeRawUnsafe(`delete from ${table} where user_id = any($1::uuid[])`, ids);
  }
});

describe("the activity grid (FR-Q1)", () => {
  it("draws one cell per day in the range, empty days included", async () => {
    await seedDay(alice, "2026-06-10", { focusMinutes: 90 });

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
      { day: "2026-06-10", value: 30, intensity: 1 },
    ]);
  });

  it("says when the rollup last wrote this range, and null when it never has", async () => {
    // A stale grid and an empty grid are otherwise the same picture, and the nightly job is the
    // thing most likely to fail quietly.
    expect((await gridOf(alice)).rebuiltAt).toBeNull();

    await seedDay(alice, "2026-06-10", { focusMinutes: 30 });
    expect((await gridOf(alice)).rebuiltAt).toBe("2026-06-29T03:00:00.000Z");
  });

  it("refuses a range that runs backwards, or one longer than a year", async () => {
    expect(
      (await get("/v1/insights/activity?from=2026-06-28&to=2026-06-01", alice)).statusCode,
    ).toBe(422);
    expect(
      (await get("/v1/insights/activity?from=2025-01-01&to=2026-12-31", alice)).statusCode,
    ).toBe(422);
  });

  it("never draws another user's days", async () => {
    await seedDay(bob, "2026-06-10", { focusMinutes: 240 });

    const grid = await gridOf(alice);

    expect(grid.cells.every((cell) => cell.value === 0)).toBe(true);
    expect(grid.activeDaysIn28).toBe(0);
    expect(grid.rebuiltAt).toBeNull();
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
    const etag = String((await get(GRID_URL, alice)).headers["etag"]);

    const response = await get(GRID_URL, alice, { "if-none-match": `W/${etag}` });

    expect(response.statusCode).toBe(304);
  });

  it("honours a list, and the wildcard", async () => {
    const etag = String((await get(GRID_URL, alice)).headers["etag"]);

    expect((await get(GRID_URL, alice, { "if-none-match": `"stale", ${etag}` })).statusCode).toBe(
      304,
    );
    expect((await get(GRID_URL, alice, { "if-none-match": "*" })).statusCode).toBe(304);
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
  });
});
