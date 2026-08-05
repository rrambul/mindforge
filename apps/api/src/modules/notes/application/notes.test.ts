import type { NoteSubject } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import { SequentialIdGenerator } from "../../../shared/ids/id-generator.js";
import { FixedClock } from "../../../shared/time/clock.js";
import { NoteNotFound } from "../domain/errors.js";
import type { Note } from "../domain/note.js";
import type { NoteFilter, NoteRepository } from "../domain/note.repository.js";
import { DeleteNote, EditNote, ListNotes, WriteNote } from "./note.use-cases.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const SUBJECT = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-05T12:00:00Z");

class InMemoryNotes implements NoteRepository {
  private readonly byUser = new Map<string, Map<string, Note>>();
  saveCount = 0;
  deleted: string[] = [];

  private own(userId: string): Map<string, Note> {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const created = new Map<string, Note>();
    this.byUser.set(userId, created);
    return created;
  }

  findById(userId: string, id: string): Promise<Note | null> {
    return Promise.resolve(this.own(userId).get(id) ?? null);
  }

  list(userId: string, filter: NoteFilter): Promise<Note[]> {
    let all = [...this.own(userId).values()];
    if (filter.subjectType) all = all.filter((n) => n.subjectType === filter.subjectType);
    if (filter.subjectId) all = all.filter((n) => n.subjectId === filter.subjectId);
    if (filter.pinned !== undefined) all = all.filter((n) => n.pinned === filter.pinned);
    if (filter.q) all = all.filter((n) => n.body.includes(filter.q!));
    if (filter.limit !== undefined) all = all.slice(0, filter.limit);
    return Promise.resolve(all);
  }

  save(userId: string, note: Note): Promise<void> {
    this.saveCount += 1;
    this.own(userId).set(note.id, note);
    return Promise.resolve();
  }

  delete(userId: string, id: string): Promise<void> {
    this.deleted.push(id);
    this.own(userId).delete(id);
    return Promise.resolve();
  }
}

describe("WriteNote", () => {
  let notes: InMemoryNotes;
  let write: WriteNote;

  beforeEach(() => {
    notes = new InMemoryNotes();
    write = new WriteNote(notes, new FixedClock(NOW), new SequentialIdGenerator());
  });

  it("writes a standalone note from text alone", async () => {
    // FR-N3: one tap. Anything else required would put a form between a thought and recording it.
    const note = await write.execute(
      ALICE,
      {
        body: "the borrow checker finally clicked",
        subjectType: "standalone",
        lang: "english",
        pinned: false,
      },
      "en",
    );

    expect(note.body).toBe("the borrow checker finally clicked");
    expect(note.subjectType).toBe("standalone");
    expect(note.subjectId).toBeNull();
    expect(note.isHighlight).toBe(false);
  });

  it("attaches to the subject the caller names, never one it asks for", async () => {
    // §6.14: no picker, no filing. The route knows a session is running.
    const note = await write.execute(
      ALICE,
      {
        body: "tooling broke twice",
        subjectType: "focus_session",
        subjectId: SUBJECT,
        lang: "english",
        pinned: false,
      },
      "en",
    );

    expect(note.subjectType).toBe("focus_session");
    expect(note.subjectId).toBe(SUBJECT);
  });

  it("is a highlight when it carries a quote and a locator (FR-N2)", async () => {
    const note = await write.execute(
      ALICE,
      {
        body: "this is the bit that matters",
        quote: "ownership is about responsibility",
        subjectType: "resource",
        subjectId: SUBJECT,
        locator: { page: 204 },
        lang: "english",
        pinned: false,
      },
      "en",
    );

    // Derived rather than a second column — one concept, not two features.
    expect(note.isHighlight).toBe(true);
    expect(note.locator).toEqual({ page: 204 });
  });

  describe("stemming language (FR-L4)", () => {
    it("follows the profile's content language, not the UI locale", async () => {
      // A pt-BR interface with English notes is a likely combination for this user, and the reverse
      // is too — so the stemmer follows the writing.
      const note = await write.execute(
        ALICE,
        {
          body: "a fronteira do que eu sei",
          subjectType: "standalone",
          lang: "english",
          pinned: false,
        },
        "pt-BR",
      );
      expect(note.lang).toBe("portuguese");
    });

    it("honours an explicit language over the profile's", async () => {
      // The share-target and the eventual importer both know the language of what they are carrying
      // better than the profile does.
      const note = await write.execute(
        ALICE,
        {
          body: "escrito em português",
          subjectType: "standalone",
          lang: "portuguese",
          pinned: false,
        },
        "en",
      );
      expect(note.lang).toBe("portuguese");
    });
  });

  it("is idempotent on a replayed id, so notes can ride the offline queue", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const base = {
      subjectType: "standalone" as NoteSubject,
      lang: "english" as const,
      pinned: false,
    };

    const first = await write.execute(ALICE, { id, body: "first", ...base }, "en");
    const replay = await write.execute(ALICE, { id, body: "different", ...base }, "en");

    expect(replay.id).toBe(first.id);
    expect(replay.body).toBe("first");
    expect(notes.saveCount).toBe(1);
  });

  it("does not let one user's id collide with another's", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const base = {
      subjectType: "standalone" as NoteSubject,
      lang: "english" as const,
      pinned: false,
    };

    await write.execute(ALICE, { id, body: "alice's", ...base }, "en");
    await expect(write.execute(BOB, { id, body: "bob's", ...base }, "en")).resolves.toMatchObject({
      body: "bob's",
    });
  });
});

describe("EditNote", () => {
  let notes: InMemoryNotes;
  let write: WriteNote;
  let edit: EditNote;

  beforeEach(() => {
    notes = new InMemoryNotes();
    write = new WriteNote(notes, new FixedClock(NOW), new SequentialIdGenerator());
    edit = new EditNote(notes, new FixedClock(new Date("2026-08-06T09:00:00Z")));
  });

  async function aNote(): Promise<Note> {
    return write.execute(
      ALICE,
      { body: "original", subjectType: "standalone", lang: "english", pinned: false },
      "en",
    );
  }

  it("edits the body and stamps updatedAt", async () => {
    const note = await aNote();
    const after = await edit.execute(ALICE, note.id, { body: "revised" });

    expect(after.body).toBe("revised");
    expect(after.updatedAt).toEqual(new Date("2026-08-06T09:00:00Z"));
    // No revision history, unlike a mission: FR-N7 says edit history is not required, and §6.14
    // rules out the archive features that would make one worth keeping.
    expect(after.createdAt).toEqual(NOW);
  });

  it("pins and unpins", async () => {
    const note = await aNote();
    expect((await edit.execute(ALICE, note.id, { pinned: true })).pinned).toBe(true);
    expect((await edit.execute(ALICE, note.id, { pinned: false })).pinned).toBe(false);
  });

  it("clears a quote, turning a highlight back into a note", async () => {
    const highlight = await write.execute(
      ALICE,
      {
        body: "x",
        quote: "q",
        subjectType: "resource",
        subjectId: SUBJECT,
        lang: "english",
        pinned: false,
      },
      "en",
    );
    expect(highlight.isHighlight).toBe(true);

    expect((await edit.execute(ALICE, highlight.id, { quote: null })).isHighlight).toBe(false);
  });

  it("rejects an unknown note", async () => {
    await expect(
      edit.execute(ALICE, "55555555-5555-4555-8555-555555555555", { pinned: true }),
    ).rejects.toBeInstanceOf(NoteNotFound);
  });

  it("rejects another user's note as not found", async () => {
    const note = await aNote();
    await expect(edit.execute(BOB, note.id, { pinned: true })).rejects.toBeInstanceOf(NoteNotFound);
  });
});

describe("ListNotes", () => {
  let notes: InMemoryNotes;
  let write: WriteNote;

  beforeEach(() => {
    notes = new InMemoryNotes();
    write = new WriteNote(notes, new FixedClock(NOW), new SequentialIdGenerator());
  });

  async function seed(body: string, subjectType: NoteSubject, subjectId: string | null) {
    return write.execute(
      ALICE,
      {
        body,
        subjectType,
        ...(subjectId === null ? {} : { subjectId }),
        lang: "english",
        pinned: false,
      },
      "en",
    );
  }

  it("filters by subject", async () => {
    await seed("on the session", "focus_session", SUBJECT);
    await seed("unfiled", "standalone", null);

    const listed = await new ListNotes(notes).execute(ALICE, { subjectType: "focus_session" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.body).toBe("on the session");
  });

  it("caps the list, because search rather than scrolling is the retrieval story (FR-N6)", async () => {
    for (let i = 0; i < 150; i += 1) await seed(`note ${i}`, "standalone", null);
    await expect(new ListNotes(notes).execute(ALICE, {})).resolves.toHaveLength(100);
  });

  it("never lists another user's notes", async () => {
    await seed("alice's", "standalone", null);
    await expect(new ListNotes(notes).execute(BOB, {})).resolves.toEqual([]);
  });
});

describe("DeleteNote", () => {
  let notes: InMemoryNotes;
  let write: WriteNote;
  let remove: DeleteNote;

  beforeEach(() => {
    notes = new InMemoryNotes();
    write = new WriteNote(notes, new FixedClock(NOW), new SequentialIdGenerator());
    remove = new DeleteNote(notes);
  });

  it("deletes a note", async () => {
    const note = await write.execute(
      ALICE,
      { body: "x", subjectType: "standalone", lang: "english", pinned: false },
      "en",
    );

    await remove.execute(ALICE, note.id);
    expect(notes.deleted).toEqual([note.id]);
  });

  it("reports a missing note rather than succeeding silently", async () => {
    // A delete that reports success for a note you do not own is a confusing way to discover RLS is
    // working.
    await expect(
      remove.execute(ALICE, "55555555-5555-4555-8555-555555555555"),
    ).rejects.toBeInstanceOf(NoteNotFound);
  });

  it("refuses to delete another user's note, and does not touch it", async () => {
    const note = await write.execute(
      ALICE,
      { body: "x", subjectType: "standalone", lang: "english", pinned: false },
      "en",
    );

    await expect(remove.execute(BOB, note.id)).rejects.toBeInstanceOf(NoteNotFound);
    expect(notes.deleted).toEqual([]);
  });
});
