import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * Resources end to end (FR-R1..R6).
 *
 * The integration level earns its keep here for three things a unit test cannot show: the `progress`
 * **JSON column** survives a round trip with its unit intact, RLS keeps one user's library out of
 * another's, and the mission link is written in the **same transaction** as the resource.
 *
 * `fetch` is stubbed for the whole file. Non-negotiable 8 rules out live calls, and a capture test
 * that depended on a real site would be the flakiest test in the repo.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;

interface ResourceResponse {
  id: string;
  type: string;
  title: string;
  author: string | null;
  url: string | null;
  status: string;
  abandonReason: string | null;
  progress: { unit: string; current: number; total: number | null } | null;
  fraction: number | null;
  isMeasurable: boolean;
  missionIds: string[];
  skillIds: string[];
  finishedAt: string | null;
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

function put(url: string, user: TestUser, payload: object) {
  return app.inject({ method: "PUT", url, headers: bearer(user), payload });
}

function get(url: string, user: TestUser | null) {
  return app.inject({ method: "GET", url, headers: user ? bearer(user) : {} });
}

async function capture(user: TestUser, payload: object): Promise<ResourceResponse> {
  const response = await post("/v1/resources/capture", user, payload);
  expect(response.statusCode, response.body).toBe(201);
  return JSON.parse(response.body) as ResourceResponse;
}

async function add(user: TestUser, payload: object): Promise<ResourceResponse> {
  const response = await post("/v1/resources", user, payload);
  expect(response.statusCode, response.body).toBe(201);
  return JSON.parse(response.body) as ResourceResponse;
}

/** A mission to link against. */
async function aMission(user: TestUser): Promise<string> {
  const response = await post("/v1/missions", user, { topic: `Mission ${crypto.randomUUID()}` });
  expect(response.statusCode, response.body).toBe(201);
  return (JSON.parse(response.body) as { id: string }).id;
}

function listOf(response: { body: string }): ResourceResponse[] {
  return (JSON.parse(response.body) as { resources: ResourceResponse[] }).resources;
}

/**
 * The hosts this file pretends to serve. `.test` is reserved by RFC 6761 precisely so it can never
 * resolve, which makes an accidentally-unstubbed request a failure rather than a real request.
 */
const STUBBED_HOSTS = ["example.test", "unreachable.test", "doc.rust-lang.test"];

const realFetch = globalThis.fetch;

/**
 * What the stubbed hosts currently return, or null for "unreachable".
 *
 * Held in a variable rather than baked into the stub because a page has to be servable more than
 * once — a duplicate-capture test asks for the same URL twice, and a `Response` body can only be
 * read once.
 */
let servedHtml: string | null = null;

/**
 * Routes only the stubbed hosts; **everything else reaches the real fetch**.
 *
 * That delegation is the whole point. Auth verifies tokens against Supabase's JWKS over the network,
 * so a blanket `fetch` stub turns every request in the file into a 401 — which looks like an auth bug
 * and is not one.
 */
function installFetchStub(): void {
  // Parameters taken from the global rather than written out: `RequestInfo` is a DOM lib type, and
  // this package's tsconfig does not include the DOM.
  vi.stubGlobal("fetch", (...args: Parameters<typeof globalThis.fetch>) => {
    const [input, init] = args;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (!STUBBED_HOSTS.some((host) => url.includes(host))) return realFetch(input, init);
    if (servedHtml === null) return Promise.reject(new Error("stubbed host is unreachable"));

    return Promise.resolve(
      new Response(servedHtml, { status: 200, headers: { "content-type": "text/html" } }),
    );
  });
}

/** A page that describes itself, so capture has something to find. */
function servePage(html: string): void {
  servedHtml = html;
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
  // Unreachable by default, so a capture test that does not serve a page exercises the failure path
  // rather than silently depending on one set up by an earlier test.
  servedHtml = null;
  installFetchStub();
  const ids = [alice.id, bob.id];
  await db.$executeRawUnsafe(`delete from resources where user_id = any($1::uuid[])`, ids);
  // Links cascade from both, so these have to go too or a later test sees a stale one.
  await db.$executeRawUnsafe(`delete from missions where user_id = any($1::uuid[])`, ids);
  await db.$executeRawUnsafe(`delete from skills where user_id = any($1::uuid[])`, ids);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("capture (FR-R2)", () => {
  it("takes a URL alone and fills in the rest", async () => {
    servePage(`
      <head>
        <meta property="og:title" content="Understanding Ownership">
        <meta property="og:site_name" content="The Rust Book">
      </head>`);

    const resource = await capture(alice, { url: "https://doc.rust-lang.test/ch04" });

    expect(resource.title).toBe("Understanding Ownership");
    expect(resource.author).toBe("The Rust Book");
    // Guessed from the URL, not asked for: a `doc.` host is documentation.
    expect(resource.type).toBe("docs");
    expect(resource.status).toBe("inbox");
  });

  it("keeps the capture when the page cannot be read", async () => {
    // The failure the whole design is arranged around: losing a URL because a title lookup failed.
    const resource = await capture(alice, { url: "https://unreachable.test/a" });

    expect(resource.title).toBe("https://unreachable.test/a");
    expect(resource.url).toBe("https://unreachable.test/a");
  });

  it("returns the same resource for a URL already captured", async () => {
    servePage("<head><title>A</title></head>");
    const first = await capture(alice, { url: "https://example.test/a" });
    const again = await capture(alice, { url: "https://example.test/a" });

    expect(again.id).toBe(first.id);

    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from resources where user_id = $1::uuid`,
      alice.id,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("converges on one resource when a capture is replayed offline", async () => {
    const id = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";
    await capture(alice, { id, url: "https://example.test/first" });
    await capture(alice, { id, url: "https://example.test/second" });

    const listed = listOf(await get("/v1/resources", alice));
    expect(listed).toHaveLength(1);
    expect(listed[0]?.url).toBe("https://example.test/first");
  });

  it("does not collide with another user's capture of the same URL", async () => {
    // Two people reading the same article is the normal case, not a conflict.
    const alices = await capture(alice, { url: "https://example.test/shared" });
    const bobs = await capture(bob, { url: "https://example.test/shared" });

    expect(bobs.id).not.toBe(alices.id);
  });

  it("links to a mission in the same write", async () => {
    const mission = JSON.parse(
      (await post("/v1/missions", alice, { topic: "Rust ownership" })).body,
    ) as { id: string };

    const resource = await capture(alice, {
      url: "https://example.test/a",
      missionId: mission.id,
    });

    const links = await db.$queryRawUnsafe<{ mission_id: string }[]>(
      `select mission_id from resource_links where resource_id = $1::uuid`,
      resource.id,
    );
    expect(links[0]?.mission_id).toBe(mission.id);
  });

  it("keeps the capture but never fetches an internal address", async () => {
    // The schema validates that the input is *a* URL and nothing more, so without the host check this
    // endpoint made the API probe its own network on request. The URL is still worth saving — only its
    // title is not fetched, exactly as for a timeout.
    const resource = await capture(alice, { url: "http://169.254.169.254/latest/meta-data/" });

    expect(resource.url).toBe("http://169.254.169.254/latest/meta-data/");
    expect(resource.title).toBe("http://169.254.169.254/latest/meta-data/");
  });

  it("refuses something that is not a URL", async () => {
    expect((await post("/v1/resources/capture", alice, { url: "nonsense" })).statusCode).toBe(422);
  });
});

describe("links (FR-R3)", () => {
  /** A skill, written directly: `id` has no database default, since Prisma generates it client-side. */
  async function aSkill(user: TestUser, name: string): Promise<string> {
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(
      `insert into skills (id, user_id, name, slug)
       values (gen_random_uuid(), $1::uuid, $2, $2 || '-' || gen_random_uuid())
       returning id`,
      user.id,
      name,
    );
    return rows[0]!.id;
  }

  it("links a resource to a mission and a skill, and reports both", async () => {
    const missionId = await aMission(alice);
    const skillId = await aSkill(alice, "Rust ownership");
    const resource = await add(alice, { type: "book", title: "Programming Rust" });

    const linked = JSON.parse(
      (
        await put(`/v1/resources/${resource.id}/links`, alice, {
          missionIds: [missionId],
          skillIds: [skillId],
        })
      ).body,
    ) as ResourceResponse;

    expect(linked.missionIds).toEqual([missionId]);
    expect(linked.skillIds).toEqual([skillId]);
  });

  it("reports the links on the list too, without a query per card", async () => {
    const missionId = await aMission(alice);
    const resource = await add(alice, { type: "book", title: "Programming Rust" });
    await put(`/v1/resources/${resource.id}/links`, alice, { missionIds: [missionId] });

    const listed = listOf(await get("/v1/resources", alice));
    expect(listed[0]?.missionIds).toEqual([missionId]);
  });

  it("replaces the set rather than adding to it", async () => {
    const first = await aMission(alice);
    const second = await aMission(alice);
    const resource = await add(alice, { type: "book", title: "x" });

    await put(`/v1/resources/${resource.id}/links`, alice, { missionIds: [first] });
    const after = JSON.parse(
      (await put(`/v1/resources/${resource.id}/links`, alice, { missionIds: [second] })).body,
    ) as ResourceResponse;

    expect(after.missionIds).toEqual([second]);
  });

  it("unlinks everything on an empty body", async () => {
    const missionId = await aMission(alice);
    const resource = await add(alice, { type: "book", title: "x" });
    await put(`/v1/resources/${resource.id}/links`, alice, { missionIds: [missionId] });

    const after = JSON.parse(
      (await put(`/v1/resources/${resource.id}/links`, alice, {})).body,
    ) as ResourceResponse;
    expect(after.missionIds).toEqual([]);

    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from resource_links where resource_id = $1::uuid`,
      resource.id,
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("refuses a mission that does not exist with a 422 naming the field", async () => {
    const resource = await add(alice, { type: "book", title: "x" });
    const response = await put(`/v1/resources/${resource.id}/links`, alice, {
      missionIds: ["99999999-9999-4999-8999-999999999999"],
    });

    expect(response.statusCode).toBe(422);
    const problem = JSON.parse(response.body) as { errors: { field: string }[]; detail: string };
    expect(problem.errors[0]?.field).toBe("missionIds");
    expect(problem.detail).toContain("mission");
  });

  it("refuses another user's mission — RLS makes it the same answer as missing", async () => {
    const bobsMission = await aMission(bob);
    const resource = await add(alice, { type: "book", title: "x" });

    expect(
      (await put(`/v1/resources/${resource.id}/links`, alice, { missionIds: [bobsMission] }))
        .statusCode,
    ).toBe(422);
  });

  it("cannot link another user's resource", async () => {
    const bobs = await add(bob, { type: "book", title: "bob's" });
    const missionId = await aMission(alice);

    expect(
      (await put(`/v1/resources/${bobs.id}/links`, alice, { missionIds: [missionId] })).statusCode,
    ).toBe(404);
  });

  it("drops the link when the mission is deleted, rather than leaving one pointing nowhere", async () => {
    // `on delete cascade` from missions. A link to a deleted mission would render as a raw uuid.
    const missionId = await aMission(alice);
    const resource = await add(alice, { type: "book", title: "x" });
    await put(`/v1/resources/${resource.id}/links`, alice, { missionIds: [missionId] });

    await db.$executeRawUnsafe(`delete from missions where id = $1::uuid`, missionId);

    const listed = listOf(await get("/v1/resources", alice));
    expect(listed[0]?.missionIds).toEqual([]);
  });

  it("carries the link the guided first mission wrote at capture time", async () => {
    // Capture writes it in the same transaction as the resource; this proves the read path agrees.
    const missionId = await aMission(alice);
    const resource = await capture(alice, { url: "https://example.test/a", missionId });

    expect(resource.missionIds).toEqual([missionId]);
  });
});

describe("progress (FR-R3)", () => {
  it("round-trips the unit through the JSON column", async () => {
    // The column is `Json`, so nothing but a real database run proves the unit survives.
    const book = await add(alice, { type: "book", title: "Programming Rust" });
    expect(book.progress).toEqual({ unit: "page", current: 0, total: null });

    const response = await patch(`/v1/resources/${book.id}/progress`, alice, {
      current: 295,
      total: 590,
    });
    const after = JSON.parse(response.body) as ResourceResponse;

    expect(after.progress).toEqual({ unit: "page", current: 295, total: 590 });
    expect(after.fraction).toBe(0.5);
    // Reading it is starting it (FR-R3), so the library reflects what you are actually doing.
    expect(after.status).toBe("active");
  });

  it("measures a podcast in seconds", async () => {
    const podcast = await add(alice, { type: "podcast", title: "Some Episode" });
    const after = JSON.parse(
      (await patch(`/v1/resources/${podcast.id}/progress`, alice, { current: 1420 })).body,
    ) as ResourceResponse;

    expect(after.progress?.unit).toBe("second");
    // No total was ever given, so there is no fraction — not 0%.
    expect(after.fraction).toBeNull();
  });

  it("offers no progress on an article", async () => {
    // An article is read or not; the client uses `isMeasurable` to decide whether to show a control.
    const article = await add(alice, { type: "article", title: "A Post" });
    expect(article.isMeasurable).toBe(false);
    expect(article.progress).toBeNull();

    const response = await patch(`/v1/resources/${article.id}/progress`, alice, { current: 1 });
    expect(response.statusCode).toBe(409);
  });

  it("refuses a position past the end with a message, not a 500", async () => {
    // The total is in the stored row, so no request schema can catch this — and a 500 here would tell
    // the user "nothing you did caused this" about a number they just typed.
    const book = await add(alice, { type: "book", title: "x" });
    await patch(`/v1/resources/${book.id}/progress`, alice, { current: 10, total: 100 });

    const response = await patch(`/v1/resources/${book.id}/progress`, alice, { current: 200 });
    expect(response.statusCode).toBe(422);

    const problem = JSON.parse(response.body) as {
      detail: string;
      errors: { field: string }[];
    };
    // Quotes the bound the client could not see, and names the field so the form can mark it.
    expect(problem.detail).toContain("100");
    expect(problem.errors[0]?.field).toBe("current");
  });

  it("reports another user's resource as not found", async () => {
    const book = await add(alice, { type: "book", title: "x" });
    expect((await patch(`/v1/resources/${book.id}/progress`, bob, { current: 1 })).statusCode).toBe(
      404,
    );
  });
});

describe("finishing and abandoning (FR-R5)", () => {
  it("finishes with a timestamp", async () => {
    const book = await add(alice, { type: "book", title: "x", status: "active" });
    const after = JSON.parse(
      (await post(`/v1/resources/${book.id}/finish`, alice)).body,
    ) as ResourceResponse;

    expect(after.status).toBe("finished");
    expect(after.finishedAt).not.toBeNull();
  });

  it("abandons with no reason at all", async () => {
    const book = await add(alice, { type: "book", title: "x", status: "active" });
    const after = JSON.parse(
      (await post(`/v1/resources/${book.id}/abandon`, alice, {})).body,
    ) as ResourceResponse;

    expect(after.status).toBe("abandoned");
    expect(after.abandonReason).toBeNull();
  });

  it("stores a reason when given, and clears it if the resource comes back", async () => {
    const book = await add(alice, { type: "book", title: "x", status: "active" });
    await post(`/v1/resources/${book.id}/abandon`, alice, { reason: "too shallow" });

    const revived = JSON.parse(
      (await patch(`/v1/resources/${book.id}`, alice, { status: "active" })).body,
    ) as ResourceResponse;
    expect(revived.abandonReason).toBeNull();

    // Proven in the database, not just the response: a stale reason would poison FR-R5's analysis.
    const rows = await db.$queryRawUnsafe<{ abandon_reason: string | null }[]>(
      `select abandon_reason from resources where id = $1::uuid`,
      book.id,
    );
    expect(rows[0]?.abandon_reason).toBeNull();
  });

  it("clears finishedAt when a finished resource is reopened", async () => {
    const book = await add(alice, { type: "book", title: "x", status: "active" });
    await post(`/v1/resources/${book.id}/finish`, alice);

    const reopened = JSON.parse(
      (await patch(`/v1/resources/${book.id}`, alice, { status: "active" })).body,
    ) as ResourceResponse;
    expect(reopened.finishedAt).toBeNull();
  });
});

describe("listing", () => {
  it("puts what you are reading first and what is over last", async () => {
    // `status` is a text column, so ordering it in SQL would be alphabetical and put `abandoned`
    // at the top — the exact trap missions fell into.
    await add(alice, { type: "book", title: "done", status: "finished" });
    await add(alice, { type: "book", title: "quit", status: "abandoned" });
    await add(alice, { type: "book", title: "reading", status: "active" });
    await add(alice, { type: "article", title: "untriaged", status: "inbox" });

    expect(listOf(await get("/v1/resources", alice)).map((r) => r.title)).toEqual([
      "reading",
      "untriaged",
      "done",
      "quit",
    ]);
  });

  it("filters to the inbox, which is how triage is done", async () => {
    await add(alice, { type: "article", title: "untriaged", status: "inbox" });
    await add(alice, { type: "book", title: "reading", status: "active" });

    expect(listOf(await get("/v1/resources?status=inbox", alice)).map((r) => r.title)).toEqual([
      "untriaged",
    ]);
  });

  it("filters by type", async () => {
    await add(alice, { type: "book", title: "a book" });
    await add(alice, { type: "podcast", title: "an episode" });

    expect(listOf(await get("/v1/resources?type=podcast", alice)).map((r) => r.title)).toEqual([
      "an episode",
    ]);
  });

  it("never lists another user's library", async () => {
    await add(bob, { type: "book", title: "bob's book" });
    expect(listOf(await get("/v1/resources", alice))).toEqual([]);
  });
});

describe("editing", () => {
  it("corrects a wrong type guess and resets the progress with it", async () => {
    const captured = await add(alice, { type: "article", title: "x" });
    const after = JSON.parse(
      (await patch(`/v1/resources/${captured.id}`, alice, { type: "video" })).body,
    ) as ResourceResponse;

    expect(after.type).toBe("video");
    expect(after.progress).toEqual({ unit: "second", current: 0, total: null });
  });

  it("cannot touch another user's resource", async () => {
    const bobs = await add(bob, { type: "book", title: "bob's" });
    expect((await patch(`/v1/resources/${bobs.id}`, alice, { title: "hijacked" })).statusCode).toBe(
      404,
    );

    const rows = await db.$queryRawUnsafe<{ title: string }[]>(
      `select title from resources where id = $1::uuid`,
      bobs.id,
    );
    expect(rows[0]?.title).toBe("bob's");
  });

  it("rejects a body that changes nothing", async () => {
    const book = await add(alice, { type: "book", title: "x" });
    expect((await patch(`/v1/resources/${book.id}`, alice, {})).statusCode).toBe(422);
  });
});

describe("auth", () => {
  it("requires a token on every route", async () => {
    expect((await get("/v1/resources", null)).statusCode).toBe(401);
    expect((await post("/v1/resources", null, { type: "book", title: "x" })).statusCode).toBe(401);
    expect((await post("/v1/resources/capture", null, { url: "https://x.test" })).statusCode).toBe(
      401,
    );
  });
});
