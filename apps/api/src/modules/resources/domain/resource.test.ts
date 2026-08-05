import type { ResourceStatus, ResourceType } from "@mindforge/core";
import { describe, expect, it } from "vitest";
import { ProgressOutOfRange, ResourceHasNoProgress } from "./errors.js";
import { Resource, type ResourceSnapshot } from "./resource.js";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-05T12:00:00Z");
const LATER = new Date("2026-08-06T09:00:00Z");

function added(type: ResourceType = "book", status: ResourceStatus = "inbox"): Resource {
  return Resource.add({
    id: ID,
    userId: USER,
    type,
    title: "Programming Rust",
    author: null,
    url: null,
    status,
    now: NOW,
  });
}

function snapshotOf(overrides: Partial<ResourceSnapshot> = {}): ResourceSnapshot {
  return {
    id: ID,
    userId: USER,
    type: "book",
    title: "Programming Rust",
    author: null,
    url: null,
    status: "inbox",
    abandonReason: null,
    progress: { unit: "page", current: 0, total: null },
    addedAt: NOW,
    finishedAt: null,
    ...overrides,
  };
}

describe("add", () => {
  it("seeds progress so a captured resource is immediately markable", () => {
    // A first progress update should not have to also declare what unit the thing is measured in.
    expect(added("book").progress).toEqual({ unit: "page", current: 0, total: null });
    expect(added("podcast").progress?.unit).toBe("second");
  });

  it("leaves progress empty for something that is not measured", () => {
    // An article is read or not; a zeroed page count would be a figure with no referent.
    expect(added("article").progress).toBeNull();
    expect(added("docs").isMeasurable).toBe(false);
  });

  it("rejects a blank title", () => {
    expect(() => Resource.fromSnapshot(snapshotOf({ title: "  " }))).toThrow(RangeError);
  });
});

describe("markProgress", () => {
  it("records the position", () => {
    const resource = added();
    resource.markProgress(137, 590, NOW);
    expect(resource.progress).toEqual({ unit: "page", current: 137, total: 590 });
  });

  it("moves a captured or queued resource into active", () => {
    // Otherwise the library fills with things sitting in `queued` that you are demonstrably reading,
    // which would make M2's "queue growth vs. throughput" a measurement of triage habits rather than
    // of reading.
    const fromInbox = added("book", "inbox");
    fromInbox.markProgress(10, null, NOW);
    expect(fromInbox.status).toBe("active");

    const fromQueue = added("book", "queued");
    fromQueue.markProgress(10, null, NOW);
    expect(fromQueue.status).toBe("active");
  });

  it("does not resurrect something finished or abandoned", () => {
    // Marking a page in a book you finished is a correction, not a resumption — changing the status
    // would silently undo a decision you made.
    const finished = Resource.fromSnapshot(snapshotOf({ status: "finished", finishedAt: NOW }));
    finished.markProgress(300, 590, LATER);
    expect(finished.status).toBe("finished");
  });

  it("remembers the total when a later update omits it", () => {
    const resource = added();
    resource.markProgress(137, 590, NOW);
    resource.markProgress(200, undefined, NOW);
    expect(resource.progress).toEqual({ unit: "page", current: 200, total: 590 });
  });

  it("refuses a position past the end, or a negative one", () => {
    // A named domain error rather than a RangeError, because the total lives in the stored row and no
    // request schema can catch it — so this is reachable from the wire and has to become a 422 with a
    // message, not a 500.
    const resource = added();
    resource.markProgress(100, 590, NOW);
    expect(() => resource.markProgress(600, undefined, NOW)).toThrow(ProgressOutOfRange);
    expect(() => resource.markProgress(-1, undefined, NOW)).toThrow(ProgressOutOfRange);
  });

  it("refuses progress on something that is not measured", () => {
    // UNIT_FOR_TYPE exists so the UI never offers the control; reaching this means a client ignored it.
    expect(() => added("article").markProgress(1, null, NOW)).toThrow(ResourceHasNoProgress);
  });
});

describe("finish and abandon", () => {
  it("stamps finishedAt on finishing", () => {
    const resource = added();
    resource.finish(LATER);
    expect(resource.status).toBe("finished");
    expect(resource.finishedAt).toEqual(LATER);
  });

  it("clears finishedAt when it stops being finished", () => {
    // So the column can never describe something that is no longer finished — exactly the kind of
    // stale field a "finished this month" rollup would read without questioning.
    const resource = added();
    resource.finish(LATER);
    resource.edit({ status: "active" }, LATER);
    expect(resource.finishedAt).toBeNull();
  });

  it("abandons with no reason (FR-R5)", () => {
    // Requiring a justification turns quitting into a confession, and the result is items sitting in
    // `active` forever — worse data than a bare abandonment.
    const resource = added();
    resource.abandon(null, LATER);
    expect(resource.status).toBe("abandoned");
    expect(resource.abandonReason).toBeNull();
  });

  it("keeps a reason when given, because it is prime friction data", () => {
    const resource = added();
    resource.abandon("too shallow", LATER);
    expect(resource.abandonReason).toBe("too shallow");
  });

  it("clears the reason when a resource comes back", () => {
    // People do return to books, and a stale "too shallow" on something you are now reading would
    // poison the abandonment analysis FR-R5 exists to enable.
    const resource = added();
    resource.abandon("too shallow", LATER);
    resource.edit({ status: "active" }, LATER);
    expect(resource.abandonReason).toBeNull();
  });
});

describe("edit", () => {
  it("resets progress when the type changes", () => {
    // A page number on something now known to be a podcast is a figure with no referent.
    const resource = added("book");
    resource.markProgress(137, 590, NOW);
    resource.edit({ type: "podcast" }, LATER);

    expect(resource.progress).toEqual({ unit: "second", current: 0, total: null });
  });

  it("leaves progress alone when the type is unchanged", () => {
    const resource = added("book");
    resource.markProgress(137, 590, NOW);
    resource.edit({ type: "book", title: "Programming Rust, 2nd ed" }, LATER);

    expect(resource.progress?.current).toBe(137);
  });

  it("refuses to blank the title", () => {
    const resource = added();
    expect(() => resource.edit({ title: "   " }, LATER)).toThrow(RangeError);
    expect(resource.title).toBe("Programming Rust");
  });
});

describe("fromSnapshot", () => {
  it("round-trips through toSnapshot", () => {
    const snapshot = snapshotOf({
      type: "podcast",
      status: "abandoned",
      abandonReason: "lost interest",
      progress: { unit: "second", current: 1420, total: null },
      author: "Someone",
      url: "https://example.test/ep/1",
    });
    expect(Resource.fromSnapshot(snapshot).toSnapshot()).toEqual(snapshot);
  });
});
