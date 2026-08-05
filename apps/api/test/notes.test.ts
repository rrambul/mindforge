import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * Notes end to end, and above all **search**.
 *
 * The search is the reason this file has to exist at the integration level: it runs against a
 * generated `tsvector` column that Prisma cannot express, so the query is raw SQL — and the whole
 * behaviour that matters (stemming per note's own language, FR-L4) is a Postgres feature. A unit test
 * against a fake repository would assert that a substring match worked, which is not what ships.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;

interface NoteResponse {
  id: string;
  body: string;
  subjectType: string;
  subjectId: string | null;
  quote: string | null;
  locator: Record<string, number | string> | null;
  isHighlight: boolean;
  pinned: boolean;
  lang: string;
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

async function writeNote(user: TestUser, payload: object): Promise<NoteResponse> {
  const response = await post("/v1/notes", user, payload);
  expect(response.statusCode, response.body).toBe(201);
  return JSON.parse(response.body) as NoteResponse;
}

function bodiesOf(response: { body: string }): string[] {
  return (JSON.parse(response.body) as { notes: NoteResponse[] }).notes.map((note) => note.body);
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
  await db.$executeRawUnsafe(`delete from notes where user_id = any($1::uuid[])`, [
    alice.id,
    bob.id,
  ]);
  await db.$executeRawUnsafe(`update profiles set locale = 'en' where id = any($1::uuid[])`, [
    alice.id,
    bob.id,
  ]);
});

describe("writing", () => {
  it("takes nothing but text", async () => {
    // FR-N3: one tap. The note lands unfiled rather than demanding a subject.
    const note = await writeNote(alice, { body: "the borrow checker finally clicked" });

    expect(note.subjectType).toBe("standalone");
    expect(note.subjectId).toBeNull();
    expect(note.isHighlight).toBe(false);
    expect(note.pinned).toBe(false);
  });

  it("attaches to a running session, and through it to the mission", async () => {
    const mission = JSON.parse(
      (await post("/v1/missions", alice, { topic: "Rust ownership" })).body,
    ) as { id: string };
    const session = JSON.parse(
      (await post("/v1/focus/sessions/start", alice, { missionId: mission.id })).body,
    ) as { id: string };

    const note = await writeNote(alice, {
      body: "tooling broke twice",
      subjectType: "focus_session",
      subjectId: session.id,
    });

    expect(note.subjectId).toBe(session.id);

    const listed = await get(`/v1/notes?subjectType=focus_session&subjectId=${session.id}`, alice);
    expect(bodiesOf(listed)).toEqual(["tooling broke twice"]);
  });

  it("stores a highlight as a note with a quote and a locator (FR-N2)", async () => {
    const note = await writeNote(alice, {
      body: "this is the bit that matters",
      quote: "ownership is about responsibility",
      subjectType: "resource",
      subjectId: "44444444-4444-4444-8444-444444444444",
      locator: { page: 204 },
    });

    expect(note.isHighlight).toBe(true);
    expect(note.locator).toEqual({ page: 204 });
  });

  it("refuses an attached note with no subject id", async () => {
    const response = await post("/v1/notes", alice, { body: "x", subjectType: "mission" });
    expect(response.statusCode).toBe(422);
  });

  it("refuses an empty body", async () => {
    expect((await post("/v1/notes", alice, { body: "   " })).statusCode).toBe(422);
  });

  it("converges on one note when a capture is replayed", async () => {
    const id = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    await writeNote(alice, { id, body: "first" });
    await writeNote(alice, { id, body: "second" });

    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from notes where user_id = $1::uuid`,
      alice.id,
    );
    expect(Number(rows[0]?.count)).toBe(1);
    expect(bodiesOf(await get("/v1/notes", alice))).toEqual(["first"]);
  });
});

describe("search (FR-N6)", () => {
  it("finds a note by a stemmed word, not just an exact one", async () => {
    // The point of a tsvector over a LIKE: "clicked" has to match a search for "click".
    await writeNote(alice, { body: "the borrow checker finally clicked" });

    expect(bodiesOf(await get("/v1/notes?q=click", alice))).toHaveLength(1);
    expect(bodiesOf(await get("/v1/notes?q=checker", alice))).toHaveLength(1);
  });

  it("searches the quote as well as the body, so highlights are findable", async () => {
    await writeNote(alice, {
      body: "worth remembering",
      quote: "lifetimes describe relationships, not durations",
      subjectType: "resource",
      subjectId: "44444444-4444-4444-8444-444444444444",
      locator: { page: 12 },
    });

    expect(bodiesOf(await get("/v1/notes?q=lifetimes", alice))).toEqual(["worth remembering"]);
  });

  it("returns nothing rather than everything when there is no match", async () => {
    // The failure mode worth guarding: a search that silently degrades to "no filter" would look
    // like it found everything.
    await writeNote(alice, { body: "the borrow checker finally clicked" });
    expect(bodiesOf(await get("/v1/notes?q=kubernetes", alice))).toEqual([]);
  });

  it("survives a query full of operators instead of returning a 500", async () => {
    // websearch_to_tsquery rather than plainto_tsquery: a stray operator must not become a server
    // error, and anyone typing into a search box will eventually type one.
    await writeNote(alice, { body: "the borrow checker finally clicked" });

    for (const q of ["&&&", "borrow | ", '"unclosed', "-", "a & !"]) {
      const response = await get(`/v1/notes?q=${encodeURIComponent(q)}`, alice);
      expect(response.statusCode, q).toBe(200);
    }
  });

  it("honours a quoted phrase", async () => {
    await writeNote(alice, { body: "the borrow checker finally clicked" });
    await writeNote(alice, { body: "checker patterns for the borrow of a lifetime" });

    // Both contain both words; only one contains the phrase.
    expect(
      bodiesOf(await get(`/v1/notes?q=${encodeURIComponent('"borrow checker"')}`, alice)),
    ).toEqual(["the borrow checker finally clicked"]);
  });

  it("stems Portuguese notes with the Portuguese stemmer (FR-L4)", async () => {
    // The reason `lang` is a column rather than a setting: a note written in Portuguese needs the
    // Portuguese stemmer regardless of what the interface is showing.
    await writeNote(alice, { body: "as fronteiras do que eu sei", lang: "portuguese" });

    // "fronteira" stems to the same root as "fronteiras" only under the Portuguese configuration.
    expect(bodiesOf(await get("/v1/notes?q=fronteira", alice))).toHaveLength(1);
  });

  it("takes the stemming language from the profile when the client does not say", async () => {
    await db.$executeRawUnsafe(
      `update profiles set locale = 'pt-BR' where id = $1::uuid`,
      alice.id,
    );

    const note = await writeNote(alice, { body: "as fronteiras do que eu sei" });
    expect(note.lang).toBe("portuguese");
  });

  it("never returns another user's notes for a matching search", async () => {
    await writeNote(bob, { body: "the borrow checker finally clicked" });
    expect(bodiesOf(await get("/v1/notes?q=borrow", alice))).toEqual([]);
  });
});

describe("pinning and ordering", () => {
  it("puts pinned notes first, then the newest", async () => {
    // Pinning is the only ordering signal a user can give, so it outranks recency.
    const first = await writeNote(alice, { body: "older" });
    await writeNote(alice, { body: "newer" });

    await app.inject({
      method: "PATCH",
      url: `/v1/notes/${first.id}`,
      headers: bearer(alice),
      payload: { pinned: true },
    });

    expect(bodiesOf(await get("/v1/notes", alice))).toEqual(["older", "newer"]);
  });

  it("filters to pinned only", async () => {
    const pinned = await writeNote(alice, { body: "keep this" });
    await writeNote(alice, { body: "ordinary" });
    await app.inject({
      method: "PATCH",
      url: `/v1/notes/${pinned.id}`,
      headers: bearer(alice),
      payload: { pinned: true },
    });

    expect(bodiesOf(await get("/v1/notes?pinned=true", alice))).toEqual(["keep this"]);
  });
});

describe("editing and deleting", () => {
  it("edits the body without inventing a revision history", async () => {
    // FR-N7: edit history is not required, and §6.14 rules out the archive features that would make
    // one worth keeping.
    const note = await writeNote(alice, { body: "original" });
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/notes/${note.id}`,
      headers: bearer(alice),
      payload: { body: "revised" },
    });

    expect((JSON.parse(response.body) as NoteResponse).body).toBe("revised");
  });

  it("deletes a note", async () => {
    const note = await writeNote(alice, { body: "to be removed" });

    const response = await app.inject({
      method: "DELETE",
      url: `/v1/notes/${note.id}`,
      headers: bearer(alice),
    });
    expect(response.statusCode).toBe(204);
    expect(bodiesOf(await get("/v1/notes", alice))).toEqual([]);
  });

  it("reports a missing note on delete rather than succeeding silently", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/v1/notes/55555555-5555-4555-8555-555555555555",
      headers: bearer(alice),
    });
    expect(response.statusCode).toBe(404);
  });

  it("cannot edit or delete another user's note", async () => {
    const bobs = await writeNote(bob, { body: "bob's thought" });

    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/notes/${bobs.id}`,
      headers: bearer(alice),
      payload: { body: "hijacked" },
    });
    expect(patched.statusCode).toBe(404);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/notes/${bobs.id}`,
      headers: bearer(alice),
    });
    expect(deleted.statusCode).toBe(404);

    const rows = await db.$queryRawUnsafe<{ body: string }[]>(
      `select body from notes where id = $1::uuid`,
      bobs.id,
    );
    expect(rows[0]?.body).toBe("bob's thought");
  });

  it("requires a token", async () => {
    expect((await get("/v1/notes", null)).statusCode).toBe(401);
    expect((await post("/v1/notes", null, { body: "x" })).statusCode).toBe(401);
  });
});
