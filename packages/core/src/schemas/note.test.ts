import { describe, expect, it } from "vitest";
import {
  CreateNoteSchema,
  ListNotesQuerySchema,
  NOTE_LANGUAGES,
  NOTE_SUBJECTS,
  NoteLocatorSchema,
  UpdateNoteSchema,
  noteLanguageFor,
} from "./note.js";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("CreateNoteSchema", () => {
  it("needs nothing but text", () => {
    // FR-N3: one tap from a running session, no picker, no filing. Anything else required here
    // would put a form between a thought and recording it.
    expect(CreateNoteSchema.parse({ body: "the borrow checker finally clicked" })).toEqual({
      body: "the borrow checker finally clicked",
      subjectType: "standalone",
      lang: "english",
      pinned: false,
    });
  });

  it("defaults to standalone, the escape hatch for the unfiled thought", () => {
    // Without it the budget breaks the moment you have something to write and nowhere to put it.
    expect(CreateNoteSchema.parse({ body: "idea" }).subjectType).toBe("standalone");
  });

  it("trims and rejects a blank body", () => {
    expect(CreateNoteSchema.parse({ body: "  kept  " }).body).toBe("kept");
    expect(CreateNoteSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(CreateNoteSchema.safeParse({ body: "" }).success).toBe(false);
  });

  it("attaches to any subject the product models (FR-N1)", () => {
    for (const subjectType of NOTE_SUBJECTS) {
      const note = { body: "x", subjectType, subjectId: UUID };
      expect(CreateNoteSchema.safeParse(note).success, subjectType).toBe(true);
    }
  });

  it("requires an id when it is attached to something", () => {
    // A note claiming to be on a mission with no mission id is unreachable from that mission, so it
    // is data that looks filed and is not.
    expect(CreateNoteSchema.safeParse({ body: "x", subjectType: "mission" }).success).toBe(false);
    expect(
      CreateNoteSchema.safeParse({ body: "x", subjectType: "mission", subjectId: UUID }).success,
    ).toBe(true);
  });

  it("does not require an id for a standalone note", () => {
    expect(CreateNoteSchema.safeParse({ body: "x", subjectType: "standalone" }).success).toBe(true);
  });

  it("takes a client-generated id, so a replayed capture is not a second note", () => {
    expect(CreateNoteSchema.parse({ body: "x", id: UUID }).id).toBe(UUID);
  });

  it("is a highlight when it carries a quote and a locator (FR-N2)", () => {
    // One concept, not two features.
    const highlight = CreateNoteSchema.parse({
      body: "this is the bit that matters",
      quote: "ownership is not about memory, it is about responsibility",
      subjectType: "resource",
      subjectId: UUID,
      locator: { page: 204 },
    });

    expect(highlight.quote).toBeTruthy();
    expect(highlight.locator).toEqual({ page: 204 });
  });

  it("rejects an unknown subject rather than storing free text", () => {
    expect(CreateNoteSchema.safeParse({ body: "x", subjectType: "whatever" }).success).toBe(false);
  });
});

describe("NoteLocatorSchema", () => {
  it("accepts each type-specific shape", () => {
    expect(NoteLocatorSchema.parse({ page: 204 })).toEqual({ page: 204 });
    expect(NoteLocatorSchema.parse({ seconds: 1420 })).toEqual({ seconds: 1420 });
    expect(NoteLocatorSchema.parse({ selector: "#h3" })).toEqual({ selector: "#h3" });
  });

  it("rejects an empty locator, which locates nothing", () => {
    expect(NoteLocatorSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a page before the first one and a negative timestamp", () => {
    expect(NoteLocatorSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(NoteLocatorSchema.safeParse({ seconds: -1 }).success).toBe(false);
  });

  it("accepts the very start of a recording", () => {
    expect(NoteLocatorSchema.parse({ seconds: 0 }).seconds).toBe(0);
  });
});

describe("UpdateNoteSchema", () => {
  it("accepts a single field", () => {
    expect(UpdateNoteSchema.parse({ pinned: true })).toEqual({ pinned: true });
  });

  it("rejects a body that changes nothing", () => {
    expect(UpdateNoteSchema.safeParse({}).success).toBe(false);
  });

  it("lets a quote be cleared, turning a highlight back into a note", () => {
    expect(UpdateNoteSchema.parse({ quote: null }).quote).toBeNull();
  });
});

describe("ListNotesQuerySchema", () => {
  it("accepts no filter", () => {
    expect(ListNotesQuerySchema.parse({})).toEqual({});
  });

  it("filters by subject and by search text (FR-N6)", () => {
    const parsed = ListNotesQuerySchema.parse({
      subjectType: "resource",
      subjectId: UUID,
      q: "borrow checker",
    });
    expect(parsed.q).toBe("borrow checker");
  });

  it("coerces pinned from a query string, which is where it comes from", () => {
    expect(ListNotesQuerySchema.parse({ pinned: "true" }).pinned).toBe(true);
    expect(ListNotesQuerySchema.parse({ pinned: "false" }).pinned).toBe(false);
  });

  it("rejects an empty search rather than treating it as no filter", () => {
    // Silently dropping it would return every note to a caller that asked for a subset.
    expect(ListNotesQuerySchema.safeParse({ q: "  " }).success).toBe(false);
  });
});

describe("noteLanguageFor", () => {
  it("stems Portuguese content with the Portuguese stemmer", () => {
    // FR-L4: search stems by the language of the content, not the UI. A pt-BR interface with English
    // notes is a likely combination for this user, and the reverse is too.
    expect(noteLanguageFor("pt-BR")).toBe("portuguese");
    expect(noteLanguageFor("pt")).toBe("portuguese");
  });

  it("falls back to English for anything else", () => {
    expect(noteLanguageFor("en")).toBe("english");
    expect(noteLanguageFor("fr")).toBe("english");
  });

  it("only ever returns a configuration Postgres has", () => {
    // The value is cast straight to a regconfig by the generated `search` column, so an unknown one
    // is a failed insert rather than a bad search.
    for (const candidate of ["pt-BR", "PT", "en", "en-GB", "klingon", ""]) {
      expect(NOTE_LANGUAGES).toContain(noteLanguageFor(candidate));
    }
  });
});
