import { verifyViewToken, type LessonOutcome } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";

import { FixedClock } from "../../../shared/time/clock.js";
import { LessonNotFound, LessonNotWritten } from "../domain/errors.js";
import type { LessonRecord, LessonRepository } from "../domain/lesson.repository.js";
import { ClearLessonCompletion, CompleteLesson, GetLesson } from "./lessons.use-cases.js";
import type { LibraryReader, MissionLibrary } from "./library.port.js";
import { ReadLearningRecords, ReadReferenceLibrary } from "./read-library.js";
import { ViewGrants } from "./view-grants.js";

/**
 * The reader's use cases.
 *
 * The two things worth testing here are the two that would fail silently: a view
 * URL that grants the wrong workspace, and a completion written onto a lesson that
 * has no content to have been understood.
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const LESSON = "88888888-8888-4888-8888-888888888888";
const MISSION = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-08-10T09:00:00Z");
const SECRET = "shared-with-the-lessons-origin";

const CONFIG = { lessonsOrigin: "https://lessons.example", tokenSecret: SECRET };

function record(over: Partial<LessonRecord> = {}): LessonRecord {
  return {
    id: LESSON,
    missionId: MISSION,
    trackId: "track-1",
    moduleName: "Ownership in practice",
    slug: "borrow-checker-errors",
    title: "Borrow checker errors as a debugging tool",
    intent: "Read the error, not the code",
    status: "generated",
    difficulty: 4,
    depth: "deep_dive",
    seq: 7,
    storagePath: `workspaces/${ALICE}/rust/lessons/0007-borrow-checker-errors.html`,
    workspaceKey: "rust",
    completedAt: null,
    outcome: null,
    ...over,
  };
}

/** Keyed by user, so a use case that dropped `userId` fails here rather than in RLS. */
class InMemoryLessons implements LessonRepository {
  readonly written: {
    id: string;
    completion: { completedAt: Date; outcome: LessonOutcome } | null;
  }[] = [];

  constructor(private rows: Map<string, LessonRecord>) {}

  findById(userId: string, id: string): Promise<LessonRecord | null> {
    return Promise.resolve(this.rows.get(`${userId}:${id}`) ?? null);
  }

  setCompletion(
    userId: string,
    id: string,
    completion: { completedAt: Date; outcome: LessonOutcome } | null,
  ): Promise<void> {
    this.written.push({ id, completion });

    const key = `${userId}:${id}`;
    const existing = this.rows.get(key);
    if (existing) {
      this.rows.set(key, {
        ...existing,
        completedAt: completion?.completedAt ?? null,
        outcome: completion?.outcome ?? null,
      });
    }
    return Promise.resolve();
  }
}

function build(rows: Map<string, LessonRecord>) {
  const lessons = new InMemoryLessons(rows);
  const clock = new FixedClock(NOW);
  const grants = new ViewGrants(CONFIG, clock);
  const get = new GetLesson(lessons, grants);

  return {
    lessons,
    get,
    complete: new CompleteLesson(lessons, clock, get),
    clear: new ClearLessonCompletion(lessons, get),
  };
}

let rows: Map<string, LessonRecord>;

beforeEach(() => {
  rows = new Map([[`${ALICE}:${LESSON}`, record()]]);
});

describe("GetLesson", () => {
  it("mints a URL on the lessons origin, granting only this workspace", async () => {
    const opened = await build(rows).get.execute(ALICE, LESSON);

    const url = new URL(opened.view!.url);
    expect(url.origin).toBe("https://lessons.example");

    // The grant is the second path segment; the rest is the path inside it.
    const [, , token, ...rest] = url.pathname.split("/");
    const grant = await verifyViewToken(token!, SECRET, Math.floor(NOW.getTime() / 1000));

    expect(grant?.prefix).toBe(`workspaces/${ALICE}/rust`);
    expect(rest.join("/")).toBe("lessons/0007-borrow-checker-errors.html");
  });

  it("expires the grant rather than handing out a permanent URL", async () => {
    const opened = await build(rows).get.execute(ALICE, LESSON);
    expect(opened.view!.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());

    const token = new URL(opened.view!.url).pathname.split("/")[2]!;
    const spent = Math.floor(opened.view!.expiresAt.getTime() / 1000);

    expect(await verifyViewToken(token, SECRET, spent)).toBeNull();
  });

  it("encodes a filename written in the learner's own language", async () => {
    // The agent writes lessons in the content language (FR-L3), so `café` on disk
    // is real — and an unencoded accent is a path the lessons origin never resolves.
    rows.set(
      `${ALICE}:${LESSON}`,
      record({ storagePath: `workspaces/${ALICE}/rust/lessons/0003-café.html` }),
    );

    const opened = await build(rows).get.execute(ALICE, LESSON);
    expect(opened.view!.url).toContain("/lessons/0003-caf%C3%A9.html");
  });

  it("offers nothing to open for a lesson that is only planned", async () => {
    // Null, not a URL that 404s: "not written yet" is an invitation to have it
    // taught, and an error is not.
    rows.set(`${ALICE}:${LESSON}`, record({ status: "planned", storagePath: null, seq: null }));

    const opened = await build(rows).get.execute(ALICE, LESSON);
    expect(opened.view).toBeNull();
  });

  it("offers nothing to open before the mission has a workspace", async () => {
    rows.set(`${ALICE}:${LESSON}`, record({ workspaceKey: null }));
    expect((await build(rows).get.execute(ALICE, LESSON)).view).toBeNull();
  });

  it("offers nothing when the stored path is not inside the granted prefix", async () => {
    // Unreachable through the reindexer, which builds every path from the same
    // prefix. Checked anyway: the alternative is a URL that grants nothing and
    // 404s with no explanation.
    rows.set(`${ALICE}:${LESSON}`, record({ storagePath: "workspaces/somebody/else/x.html" }));
    expect((await build(rows).get.execute(ALICE, LESSON)).view).toBeNull();
  });

  it("does not find another user's lesson", async () => {
    await expect(build(rows).get.execute(BOB, LESSON)).rejects.toBeInstanceOf(LessonNotFound);
  });
});

describe("CompleteLesson", () => {
  it("records the outcome and when it was finished", async () => {
    const { complete, lessons } = build(rows);
    const opened = await complete.execute(ALICE, LESSON, "shaky");

    expect(lessons.written).toEqual([
      { id: LESSON, completion: { completedAt: NOW, outcome: "shaky" } },
    ]);
    expect(opened.lesson.outcome).toBe("shaky");
  });

  it("overwrites rather than appends, because a lesson finished twice is one lesson", async () => {
    const { complete } = build(rows);
    await complete.execute(ALICE, LESSON, "lost");
    const again = await complete.execute(ALICE, LESSON, "understood");

    expect(again.lesson.outcome).toBe("understood");
  });

  it("refuses a lesson that has not been written", async () => {
    // The database says the same thing (`lessons_planned_not_completed`); said
    // here so the answer is a 409 the reader can act on rather than a constraint
    // violation nobody was expecting to meet.
    rows.set(`${ALICE}:${LESSON}`, record({ status: "planned", storagePath: null, seq: null }));

    const { complete, lessons } = build(rows);
    await expect(complete.execute(ALICE, LESSON, "understood")).rejects.toBeInstanceOf(
      LessonNotWritten,
    );
    expect(lessons.written).toEqual([]);
  });

  it("does not complete another user's lesson", async () => {
    const { complete, lessons } = build(rows);
    await expect(complete.execute(BOB, LESSON, "understood")).rejects.toBeInstanceOf(
      LessonNotFound,
    );
    expect(lessons.written).toEqual([]);
  });
});

describe("ClearLessonCompletion", () => {
  it("undoes a mis-tap", async () => {
    rows.set(`${ALICE}:${LESSON}`, record({ completedAt: NOW, outcome: "lost" }));

    const { clear } = build(rows);
    const opened = await clear.execute(ALICE, LESSON);

    expect(opened.lesson.completedAt).toBeNull();
    expect(opened.lesson.outcome).toBeNull();
  });

  it("says nothing when there was nothing to clear", async () => {
    // Clearing an already-clear lesson is what the caller asked for and already
    // true; a 409 there is an error message about a state the user wanted.
    const { clear, lessons } = build(rows);
    await expect(clear.execute(ALICE, LESSON)).resolves.toMatchObject({
      lesson: { completedAt: null },
    });
    expect(lessons.written).toEqual([]);
  });

  it("does not clear another user's lesson", async () => {
    await expect(build(rows).clear.execute(BOB, LESSON)).rejects.toBeInstanceOf(LessonNotFound);
  });
});

describe("the reference library", () => {
  class InMemoryLibrary implements LibraryReader {
    constructor(private readonly library: MissionLibrary | null) {}

    referenceDocs(): Promise<MissionLibrary | null> {
      return Promise.resolve(this.library);
    }

    learningRecords(): Promise<null> {
      return Promise.resolve(null);
    }
  }

  function libraryOf(library: MissionLibrary | null): ReadReferenceLibrary {
    return new ReadReferenceLibrary(
      new InMemoryLibrary(library),
      new ViewGrants(CONFIG, new FixedClock(NOW)),
    );
  }

  const doc = {
    id: "doc-1",
    slug: "ownership",
    title: "Ownership, in one page",
    storagePath: `workspaces/${ALICE}/rust/reference/ownership.html`,
    updatedAt: NOW,
  };

  it("signs one grant for the whole list, so every URL expires together", async () => {
    const view = await libraryOf({
      workspaceKey: "rust",
      referenceDocs: [doc, { ...doc, id: "doc-2", slug: "lifetimes" }],
    }).execute(ALICE, MISSION);

    const tokens = view.docs.map((entry) => new URL(entry.url!).pathname.split("/")[2]);
    expect(new Set(tokens).size).toBe(1);
    expect(view.expiresAt).not.toBeNull();
  });

  it("offers nothing to open for a mission that has never been materialised", async () => {
    const view = await libraryOf({ workspaceKey: null, referenceDocs: [doc] }).execute(
      ALICE,
      MISSION,
    );

    expect(view.docs[0]!.url).toBeNull();
    expect(view.expiresAt).toBeNull();
  });

  it("mints nothing for an empty library", async () => {
    const view = await libraryOf({ workspaceKey: "rust", referenceDocs: [] }).execute(
      ALICE,
      MISSION,
    );

    expect(view.docs).toEqual([]);
    expect(view.expiresAt).toBeNull();
  });

  it("404s a mission that is not yours, the same as one that does not exist", async () => {
    await expect(libraryOf(null).execute(ALICE, MISSION)).rejects.toMatchObject({ status: 404 });
  });
});

describe("learning records", () => {
  class OnlyRecords implements LibraryReader {
    asked: { missionId: string; lessonId: string | undefined } | null = null;

    referenceDocs(): Promise<null> {
      return Promise.resolve(null);
    }

    learningRecords(_userId: string, missionId: string, lessonId?: string): Promise<[]> {
      this.asked = { missionId, lessonId };
      return Promise.resolve([]);
    }
  }

  it("passes the lesson filter through, which is what links a record to its lesson", async () => {
    const reader = new OnlyRecords();
    await new ReadLearningRecords(reader).execute(ALICE, MISSION, LESSON);

    expect(reader.asked).toEqual({ missionId: MISSION, lessonId: LESSON });
  });

  it("404s a mission that is not yours", async () => {
    const reader: LibraryReader = {
      referenceDocs: () => Promise.resolve(null),
      learningRecords: () => Promise.resolve(null),
    };

    await expect(new ReadLearningRecords(reader).execute(ALICE, MISSION)).rejects.toMatchObject({
      status: 404,
    });
  });
});
