import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * The account write path end to end (FR-L3, FR-L5, FR-N1, FR-N3, FR-N4, §14.1).
 *
 * Three things here can only be shown against a real database. The **jsonb columns** — a
 * notification's ICU payload and a preference's config — have to survive a round trip with their
 * shape intact, and a row this build did not write has to be readable anyway. **RLS** has to keep
 * one person's settings and nudges away from another's through the whole request path. And the
 * settings themselves have to actually land in `profiles`, which is the entire point of the
 * milestone: before this, every account sat at `timezone: 'UTC'` with no way out.
 *
 * Notifications are inserted with SQL because there is no endpoint that creates one — they are
 * raised by the nightly job (M3), and a client that could raise its own would make the dedupe key
 * that lets the job re-run meaningless.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;

interface MeResponse {
  userId: string;
  locale: string;
  contentLanguage: string;
  timezone: string;
  weekStartsOn: number;
  theme: string;
  changelogSeenVersion: string | null;
}

interface PrefResponse {
  kind: string;
  enabled: boolean;
  config: Record<string, number>;
}

interface NotificationResponse {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
  dismissedAt: string | null;
}

function get(url: string, user: TestUser | null) {
  return app.inject({ method: "GET", url, headers: user ? bearer(user) : {} });
}

function patch(url: string, user: TestUser | null, payload: object) {
  return app.inject({ method: "PATCH", url, headers: user ? bearer(user) : {}, payload });
}

function put(url: string, user: TestUser | null, payload: object) {
  return app.inject({ method: "PUT", url, headers: user ? bearer(user) : {}, payload });
}

function post(url: string, user: TestUser | null, payload: object) {
  return app.inject({ method: "POST", url, headers: user ? bearer(user) : {}, payload });
}

async function me(user: TestUser): Promise<MeResponse> {
  const response = await get("/v1/me", user);
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as MeResponse;
}

async function updateSettings(user: TestUser, body: object): Promise<MeResponse> {
  const response = await patch("/v1/me", user, body);
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as MeResponse;
}

function prefsOf(response: { body: string }): PrefResponse[] {
  return (JSON.parse(response.body) as { prefs: PrefResponse[] }).prefs;
}

function notificationsOf(response: { body: string }): NotificationResponse[] {
  return (JSON.parse(response.body) as { notifications: NotificationResponse[] }).notifications;
}

function prefFor(prefs: readonly PrefResponse[], kind: string): PrefResponse | undefined {
  return prefs.find((pref) => pref.kind === kind);
}

/** A nudge, written the way the nightly job will write it. */
async function raise(
  user: TestUser,
  fields: {
    kind?: string;
    payload?: unknown;
    subjectType?: string | null;
    subjectId?: string | null;
    createdAt: string;
  },
): Promise<string> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into notifications
       (id, user_id, kind, dedupe_key, payload, subject_type, subject_id, created_at)
     values (gen_random_uuid(), $1::uuid, $2, $3, $4::jsonb, $5, $6::uuid, $7::timestamptz)
     returning id`,
    user.id,
    fields.kind ?? "stall",
    `${fields.kind ?? "stall"}:${crypto.randomUUID()}`,
    JSON.stringify(fields.payload ?? {}),
    fields.subjectType === undefined ? "mission" : fields.subjectType,
    fields.subjectId ?? null,
    fields.createdAt,
  );
  return rows[0]!.id;
}

/** A preference row, written the way some other version of the app might have left it. */
async function storePrefRow(user: TestUser, kind: string, enabled: boolean, config: unknown) {
  await db.$executeRawUnsafe(
    `insert into notification_prefs (user_id, kind, enabled, config)
     values ($1::uuid, $2, $3, $4::jsonb)
     on conflict (user_id, kind) do update
        set enabled = excluded.enabled, config = excluded.config`,
    user.id,
    kind,
    enabled,
    JSON.stringify(config),
  );
}

async function profileRow(user: TestUser) {
  const rows = await db.$queryRawUnsafe<
    {
      timezone: string;
      locale: string;
      content_language: string;
      week_starts_on: number;
      theme: string;
      changelog_seen_version: string | null;
    }[]
  >(
    `select timezone, locale, content_language, week_starts_on, theme, changelog_seen_version
       from profiles where id = $1::uuid`,
    user.id,
  );
  return rows[0]!;
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
  await db.$executeRawUnsafe(`delete from notifications where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from notification_prefs where user_id = any($1::uuid[])`, ids);
  // Back to what the signup trigger leaves behind, so no test inherits another's settings.
  await db.$executeRawUnsafe(
    `update profiles
        set timezone = 'UTC', locale = 'en', content_language = 'en',
            week_starts_on = 1, theme = 'light', changelog_seen_version = null
      where id = any($1::uuid[])`,
    ids,
  );
});

describe("GET /v1/me", () => {
  it("carries every setting the SPA needs before it renders a string", async () => {
    // Widened in M2: `contentLanguage`, `theme` and `changelogSeenVersion` are not in the request
    // context the guard builds, which is why this route now reads the row.
    expect(await me(alice)).toEqual({
      userId: alice.id,
      locale: "en",
      contentLanguage: "en",
      timezone: "UTC",
      weekStartsOn: 1,
      theme: "light",
      // Null means never opened, which is not the same as up to date (§14.1).
      changelogSeenVersion: null,
    });
  });
});

describe("PATCH /v1/me (FR-L3, FR-L5)", () => {
  it("writes the timezone and week start the rollup and the plan grid depend on", async () => {
    const updated = await updateSettings(alice, {
      timezone: "America/Sao_Paulo",
      weekStartsOn: 0,
    });

    expect(updated.timezone).toBe("America/Sao_Paulo");
    expect(updated.weekStartsOn).toBe(0);

    // Proven in the row, not just the response: the whole milestone rests on this column being
    // settable, and it was not before M2.
    const row = await profileRow(alice);
    expect(row.timezone).toBe("America/Sao_Paulo");
    expect(row.week_starts_on).toBe(0);
  });

  it("leaves out of the UPDATE everything the body did not name", async () => {
    await updateSettings(alice, { theme: "dark", contentLanguage: "pt-BR" });
    const after = await updateSettings(alice, { timezone: "Europe/Lisbon" });

    expect(after.theme).toBe("dark");
    expect(after.contentLanguage).toBe("pt-BR");
    // And the interface language did not follow the content language, which is FR-L3's point.
    expect(after.locale).toBe("en");
  });

  it("does not move the week start when the locale changes", async () => {
    // FR-L5: seeded from locale at signup, owned by the user afterwards. Deriving it on every
    // locale change would silently re-bucket weeks the user has already planned.
    const updated = await updateSettings(alice, { locale: "pt-BR" });

    expect(updated.locale).toBe("pt-BR");
    expect(updated.weekStartsOn).toBe(1);
  });

  it("refuses a zone the IANA database does not have", async () => {
    // Validated against `Intl` rather than a list in the codebase, which would be wrong in a year.
    const response = await patch("/v1/me", alice, { timezone: "Mars/Phobos" });

    expect(response.statusCode).toBe(422);
    const problem = JSON.parse(response.body) as { errors: { field: string }[] };
    expect(problem.errors[0]?.field).toBe("timezone");
  });

  it("refuses a locale this build does not ship", async () => {
    expect((await patch("/v1/me", alice, { locale: "fr" })).statusCode).toBe(422);
  });

  it("refuses a week start that is not Sunday or Monday", async () => {
    expect((await patch("/v1/me", alice, { weekStartsOn: 3 })).statusCode).toBe(422);
  });

  it("refuses a body that changes nothing", async () => {
    expect((await patch("/v1/me", alice, {})).statusCode).toBe(422);
  });

  it("cannot reach another user's settings", async () => {
    await updateSettings(alice, { timezone: "America/Sao_Paulo", theme: "dark" });

    expect((await me(bob)).timezone).toBe("UTC");
    const row = await profileRow(bob);
    expect(row.timezone).toBe("UTC");
    expect(row.theme).toBe("light");
  });
});

describe("POST /v1/me/changelog-seen (§14.1)", () => {
  it("records the version and touches nothing else", async () => {
    // Separate from the settings patch on purpose: folding it in would let a theme change clear
    // the unseen dot as a byproduct.
    await updateSettings(alice, { theme: "dark" });

    const response = await post("/v1/me/changelog-seen", alice, { version: "0.4.1" });
    expect(response.statusCode, response.body).toBe(200);

    const after = JSON.parse(response.body) as MeResponse;
    expect(after.changelogSeenVersion).toBe("0.4.1");
    expect(after.theme).toBe("dark");
  });

  it("refuses something that is not a version", async () => {
    expect((await post("/v1/me/changelog-seen", alice, { version: "latest" })).statusCode).toBe(
      422,
    );
  });

  it("does not mark anyone else's changelog read", async () => {
    await post("/v1/me/changelog-seen", alice, { version: "0.4.1" });

    expect((await me(bob)).changelogSeenVersion).toBeNull();
  });
});

describe("notification prefs (FR-N4)", () => {
  it("answers with the defaults for a profile that has no rows, and writes nothing", async () => {
    const prefs = prefsOf(await get("/v1/me/notification-prefs", alice));

    expect(prefs).toEqual([
      { kind: "weekly_review", enabled: true, config: { weekday: 0, hour: 18 } },
      { kind: "stall", enabled: true, config: { afterDays: 12 } },
    ]);

    // The load-bearing half: nothing is seeded on read. A seeded row would freeze today's defaults
    // into the account, so changing what "quiet by default" means would reach new users and nobody
    // else.
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from notification_prefs where user_id = $1::uuid`,
      alice.id,
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("round-trips the jsonb config", async () => {
    // The column is jsonb, so nothing but a real database run proves the config survives intact.
    const written = prefsOf(
      await put("/v1/me/notification-prefs", alice, {
        prefs: [{ kind: "weekly_review", enabled: true, config: { weekday: 3, hour: 7 } }],
      }),
    );
    expect(prefFor(written, "weekly_review")?.config).toEqual({ weekday: 3, hour: 7 });

    const read = prefsOf(await get("/v1/me/notification-prefs", alice));
    expect(prefFor(read, "weekly_review")?.config).toEqual({ weekday: 3, hour: 7 });
  });

  it("leaves a kind the body did not name where it was", async () => {
    await put("/v1/me/notification-prefs", alice, {
      prefs: [{ kind: "stall", enabled: false, config: { afterDays: 30 } }],
    });

    const after = prefsOf(
      await put("/v1/me/notification-prefs", alice, {
        prefs: [{ kind: "weekly_review", enabled: false, config: { weekday: 1, hour: 20 } }],
      }),
    );

    expect(prefFor(after, "stall")).toEqual({
      kind: "stall",
      enabled: false,
      config: { afterDays: 30 },
    });
  });

  it("keeps the switch when a row was written by an older version of the app", async () => {
    // Validated on the way out as well as on the way in. This row never passed through the request
    // schema, and un-muting someone because a config key was renamed is the one failure FR-N4
    // cannot afford — "a nagging app gets muted, then deleted".
    await storePrefRow(alice, "stall", false, { staleAfter: 30 });

    const prefs = prefsOf(await get("/v1/me/notification-prefs", alice));

    expect(prefFor(prefs, "stall")).toEqual({
      kind: "stall",
      enabled: false,
      config: { afterDays: 12 },
    });
  });

  it("refuses a config that belongs to the other kind", async () => {
    // Strictness is what stops the jsonb column becoming a junk drawer: without it this would parse,
    // drop the fields, and store the defaults — a setting that silently did not take.
    const response = await put("/v1/me/notification-prefs", alice, {
      prefs: [{ kind: "stall", enabled: true, config: { weekday: 0, hour: 18 } }],
    });

    expect(response.statusCode).toBe(422);
  });

  it("refuses the same kind twice rather than picking one", async () => {
    const response = await put("/v1/me/notification-prefs", alice, {
      prefs: [
        { kind: "stall", enabled: false, config: { afterDays: 12 } },
        { kind: "stall", enabled: true, config: { afterDays: 30 } },
      ],
    });

    expect(response.statusCode).toBe(422);
    const problem = JSON.parse(response.body) as { errors: { field: string }[] };
    expect(problem.errors[0]?.field).toBe("prefs");
  });

  it("never reads or writes another user's preferences", async () => {
    await put("/v1/me/notification-prefs", bob, {
      prefs: [{ kind: "stall", enabled: false, config: { afterDays: 90 } }],
    });

    // Alice still sees the defaults...
    expect(prefFor(prefsOf(await get("/v1/me/notification-prefs", alice)), "stall")?.enabled).toBe(
      true,
    );

    // ...and her own write does not reach Bob's row.
    await put("/v1/me/notification-prefs", alice, {
      prefs: [{ kind: "stall", enabled: true, config: { afterDays: 5 } }],
    });
    const bobs = await db.$queryRawUnsafe<{ enabled: boolean; config: { afterDays: number } }[]>(
      `select enabled, config from notification_prefs where user_id = $1::uuid and kind = 'stall'`,
      bob.id,
    );
    expect(bobs[0]?.enabled).toBe(false);
    expect(bobs[0]?.config.afterDays).toBe(90);
  });
});

describe("GET /v1/notifications (FR-N1, FR-N3)", () => {
  it("lists the undismissed ones newest first, with the payload untouched", async () => {
    await raise(alice, {
      kind: "stall",
      payload: { missionTopic: "Rust ownership", days: 14 },
      subjectId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-08-01T09:00:00Z",
    });
    await raise(alice, {
      kind: "weekly_review",
      payload: { weekStart: "2026-08-03" },
      subjectType: null,
      createdAt: "2026-08-04T18:00:00Z",
    });

    const listed = notificationsOf(await get("/v1/notifications", alice));

    expect(listed.map((n) => n.kind)).toEqual(["weekly_review", "stall"]);
    // ICU arguments, never rendered text — the SPA translates by `kind` (§5.2). Straight through
    // the jsonb column and out again.
    expect(listed[0]?.payload).toEqual({ weekStart: "2026-08-03" });
    expect(listed[1]?.payload).toEqual({ missionTopic: "Rust ownership", days: 14 });
    // A nudge about the week rather than about a thing has nothing to open.
    expect(listed[0]?.subjectType).toBeNull();
    expect(listed[1]?.subjectType).toBe("mission");
  });

  it("reports no arguments for a payload that is not an object", async () => {
    // jsonb will hold a scalar quite happily. ICU arguments are an object or nothing, and a nudge
    // whose payload is unreadable still says what kind it is — which is the part that carries the
    // meaning.
    await raise(alice, { payload: "a bare string", createdAt: "2026-08-01T09:00:00Z" });

    expect(notificationsOf(await get("/v1/notifications", alice))[0]?.payload).toEqual({});
  });

  it("omits one that has been dismissed", async () => {
    // FR-N5: no archive of things you failed to act on.
    const id = await raise(alice, { createdAt: "2026-08-01T09:00:00Z" });
    await post(`/v1/notifications/${id}/dismiss`, alice, {});

    expect(notificationsOf(await get("/v1/notifications", alice))).toEqual([]);
  });

  it("never lists another user's nudges", async () => {
    await raise(bob, { createdAt: "2026-08-01T09:00:00Z" });

    expect(notificationsOf(await get("/v1/notifications", alice))).toEqual([]);
  });
});

describe("POST /v1/notifications/:id/dismiss", () => {
  it("stamps the row and takes it off the list", async () => {
    const id = await raise(alice, { createdAt: "2026-08-01T09:00:00Z" });

    const response = await post(`/v1/notifications/${id}/dismiss`, alice, {});
    expect(response.statusCode, response.body).toBe(200);
    expect((JSON.parse(response.body) as NotificationResponse).dismissedAt).not.toBeNull();

    const rows = await db.$queryRawUnsafe<{ dismissed_at: Date | null }[]>(
      `select dismissed_at from notifications where id = $1::uuid`,
      id,
    );
    expect(rows[0]?.dismissed_at).not.toBeNull();
  });

  it("keeps the first timestamp when the tap is replayed", async () => {
    // Dismissing travels through the offline queue, so it arrives twice as a matter of course.
    const id = await raise(alice, { createdAt: "2026-08-01T09:00:00Z" });

    const first = JSON.parse(
      (await post(`/v1/notifications/${id}/dismiss`, alice, {})).body,
    ) as NotificationResponse;
    const again = JSON.parse(
      (await post(`/v1/notifications/${id}/dismiss`, alice, {})).body,
    ) as NotificationResponse;

    expect(again.dismissedAt).toBe(first.dismissedAt);
  });

  it("reports one that does not exist", async () => {
    const response = await post(
      "/v1/notifications/99999999-9999-4999-8999-999999999999/dismiss",
      alice,
      {},
    );
    expect(response.statusCode).toBe(404);
  });

  it("refuses an id that is not a uuid", async () => {
    expect((await post("/v1/notifications/nonsense/dismiss", alice, {})).statusCode).toBe(422);
  });

  it("cannot dismiss another user's nudge, and leaves it standing", async () => {
    const bobs = await raise(bob, { createdAt: "2026-08-01T09:00:00Z" });

    expect((await post(`/v1/notifications/${bobs}/dismiss`, alice, {})).statusCode).toBe(404);

    // RLS makes "not yours" and "not there" the same answer — and the row is genuinely untouched,
    // which a 404 alone would not prove.
    const rows = await db.$queryRawUnsafe<{ dismissed_at: Date | null }[]>(
      `select dismissed_at from notifications where id = $1::uuid`,
      bobs,
    );
    expect(rows[0]?.dismissed_at).toBeNull();
    expect(notificationsOf(await get("/v1/notifications", bob))).toHaveLength(1);
  });
});

describe("auth", () => {
  it("requires a token on every route", async () => {
    expect((await get("/v1/me", null)).statusCode).toBe(401);
    expect((await patch("/v1/me", null, { theme: "dark" })).statusCode).toBe(401);
    expect((await post("/v1/me/changelog-seen", null, { version: "1.0.0" })).statusCode).toBe(401);
    expect((await get("/v1/me/notification-prefs", null)).statusCode).toBe(401);
    expect((await put("/v1/me/notification-prefs", null, { prefs: [] })).statusCode).toBe(401);
    expect((await get("/v1/notifications", null)).statusCode).toBe(401);
    expect(
      (await post("/v1/notifications/99999999-9999-4999-8999-999999999999/dismiss", null, {}))
        .statusCode,
    ).toBe(401);
  });
});
