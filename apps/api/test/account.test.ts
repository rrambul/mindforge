import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * The account write path end to end (FR-L1..L5, §14.1).
 *
 * Two things here can only be shown against a real database. **RLS** has to keep one person's
 * settings away from another's through the whole request path. And the settings themselves have to
 * actually land in `profiles`, which is the entire point of the write path: before it existed,
 * every account sat at `timezone: 'UTC'` with no way out.
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

function get(url: string, user: TestUser | null) {
  return app.inject({ method: "GET", url, headers: user ? bearer(user) : {} });
}

function patch(url: string, user: TestUser | null, payload: object) {
  return app.inject({ method: "PATCH", url, headers: user ? bearer(user) : {}, payload });
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

describe("auth", () => {
  it("requires a token on every route", async () => {
    expect((await get("/v1/me", null)).statusCode).toBe(401);
    expect((await patch("/v1/me", null, { theme: "dark" })).statusCode).toBe(401);
    expect((await post("/v1/me/changelog-seen", null, { version: "1.0.0" })).statusCode).toBe(401);
  });
});
