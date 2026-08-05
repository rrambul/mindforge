import { describe, expect, it } from "vitest";
import { Note, type NoteSnapshot } from "./note.js";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const SUBJECT = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-05T12:00:00Z");
const LATER = new Date("2026-08-06T09:00:00Z");

function snapshotOf(overrides: Partial<NoteSnapshot> = {}): NoteSnapshot {
  return {
    id: ID,
    userId: USER,
    body: "the borrow checker finally clicked",
    subjectType: "standalone",
    subjectId: null,
    quote: null,
    locator: null,
    pinned: false,
    lang: "english",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("invariants", () => {
  it.each(["", "   ", "\n\t"])("rejects an empty body: %o", (body) => {
    // Enforced here rather than only in the Zod schema, because the share-target, the eventual
    // importer, and the seed scripts all build notes too.
    expect(() => Note.fromSnapshot(snapshotOf({ body }))).toThrow(RangeError);
  });

  it("requires an attached note to know what it is attached to", () => {
    // A note claiming to be on a mission with no mission id is unreachable from that mission — data
    // that looks filed and is not.
    expect(() =>
      Note.fromSnapshot(snapshotOf({ subjectType: "mission", subjectId: null })),
    ).toThrow(RangeError);
  });

  it("allows a standalone note to have no subject id", () => {
    // The escape hatch for the genuinely unfiled thought. Without it the ≤5s budget breaks the moment
    // you have something to write and nowhere to put it.
    expect(Note.fromSnapshot(snapshotOf()).subjectId).toBeNull();
  });
});

describe("isHighlight", () => {
  it("is true when there is a quote", () => {
    // FR-N2: a highlight is a note with a quote and a locator. Derived, never a second column, so
    // the two cannot disagree.
    const note = Note.fromSnapshot(
      snapshotOf({
        subjectType: "resource",
        subjectId: SUBJECT,
        quote: "q",
        locator: { page: 204 },
      }),
    );
    expect(note.isHighlight).toBe(true);
  });

  it("is false for a plain note", () => {
    expect(Note.fromSnapshot(snapshotOf()).isHighlight).toBe(false);
  });
});

describe("edit", () => {
  it("changes the body and stamps updatedAt", () => {
    const note = Note.fromSnapshot(snapshotOf());
    note.edit({ body: "revised" }, LATER);

    expect(note.body).toBe("revised");
    expect(note.updatedAt).toEqual(LATER);
    // No revision history: FR-N7 does not require it, and §6.14 rules out the archive features that
    // would make one worth keeping.
    expect(note.createdAt).toEqual(NOW);
  });

  it("refuses to empty a note through an edit", () => {
    const note = Note.fromSnapshot(snapshotOf());
    expect(() => note.edit({ body: "  " }, LATER)).toThrow(RangeError);
    expect(note.body).toBe("the borrow checker finally clicked");
  });

  it("leaves omitted fields alone and clears an explicit null", () => {
    const note = Note.fromSnapshot(
      snapshotOf({ subjectType: "resource", subjectId: SUBJECT, quote: "q" }),
    );

    note.edit({ pinned: true }, LATER);
    expect(note.quote).toBe("q");

    note.edit({ quote: null }, LATER);
    expect(note.quote).toBeNull();
    expect(note.pinned).toBe(true);
  });

  it("does not move the subject", () => {
    // A note does not migrate between subjects: the thing it was written about is a fact about when
    // it was written, and re-pointing it would silently rewrite history.
    const note = Note.fromSnapshot(snapshotOf({ subjectType: "resource", subjectId: SUBJECT }));
    note.edit({ body: "revised" }, LATER);
    expect(note.subjectId).toBe(SUBJECT);
  });
});

describe("fromSnapshot", () => {
  it("round-trips through toSnapshot", () => {
    const snapshot = snapshotOf({
      subjectType: "resource",
      subjectId: SUBJECT,
      quote: "q",
      locator: { seconds: 1420 },
      pinned: true,
      lang: "portuguese",
      updatedAt: LATER,
    });
    expect(Note.fromSnapshot(snapshot).toSnapshot()).toEqual(snapshot);
  });
});
