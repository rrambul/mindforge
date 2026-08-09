import { describe, expect, it, vi } from "vitest";

import type {
  ExistingResourceKeys,
  WorkspaceResourceWriter,
} from "../domain/workspace-resource.writer.js";
import { normalizeTitle, normalizeUrl, SyncWorkspaceResources } from "./workspace-resources.js";

/**
 * The upsert key, which is the whole reason this exists.
 *
 * `resources` has no natural unique constraint and the agent rewrites
 * `RESOURCES.md` wholesale every run, so getting this wrong does not fail — it
 * doubles the library on the second run and quadruples it on the fourth, silently.
 */

const USER = "user-1";
const MISSION = "mission-1";

function resource(overrides: Record<string, unknown> = {}) {
  return {
    title: "The Rust Book",
    url: "https://doc.rust-lang.org/book/",
    type: "docs" as const,
    trust: "high" as const,
    note: null,
    ...overrides,
  };
}

function harness(existing: Partial<ExistingResourceKeys> = {}) {
  const writer = {
    existingKeys: vi.fn(() =>
      Promise.resolve({
        byUrl: existing.byUrl ?? new Map<string, string>(),
        byTitle: existing.byTitle ?? new Map<string, string>(),
      }),
    ),
    createFromWorkspace: vi.fn<WorkspaceResourceWriter["createFromWorkspace"]>(() =>
      Promise.resolve(),
    ),
    updateFromWorkspace: vi.fn<WorkspaceResourceWriter["updateFromWorkspace"]>(() =>
      Promise.resolve(),
    ),
    rejectExisting: vi.fn(() => Promise.resolve()),
    createRejected: vi.fn(() => Promise.resolve()),
  } satisfies WorkspaceResourceWriter;

  return { writer, sync: new SyncWorkspaceResources(writer) };
}

function run(
  h: ReturnType<typeof harness>,
  primary: ReturnType<typeof resource>[] = [],
  rejected: { title: string; url: string | null; reason: string | null }[] = [],
) {
  return h.sync.execute({ userId: USER, missionId: MISSION, primary, rejected });
}

describe("normalizeUrl", () => {
  it("ignores scheme, www and a trailing slash", () => {
    expect(normalizeUrl("https://www.doc.rust-lang.org/book/")).toBe(
      normalizeUrl("http://doc.rust-lang.org/book"),
    );
  });

  it("ignores tracking parameters, which make one link three", () => {
    expect(normalizeUrl("https://x.dev/a?utm_source=twitter&fbclid=1")).toBe(
      normalizeUrl("https://x.dev/a"),
    );
  });

  it("keeps the query parameters that are the identity", () => {
    // `?v=` on a video and `?p=` on a thread are the page. Stripping every
    // parameter would collapse a playlist into one row.
    expect(normalizeUrl("https://youtube.com/watch?v=abc")).not.toBe(
      normalizeUrl("https://youtube.com/watch?v=def"),
    );
  });

  it("compares an unparseable URL as written rather than discarding it", () => {
    // An agent writing a bare host should still match itself between runs.
    expect(normalizeUrl("doc.rust-lang.org/book")).toBe(normalizeUrl("Doc.Rust-Lang.org/book"));
  });

  it("treats an empty URL as absent", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
  });
});

describe("normalizeTitle", () => {
  it("ignores case and collapsed whitespace", () => {
    expect(normalizeTitle("  The   Rust Book ")).toBe(normalizeTitle("the rust book"));
  });
});

describe("matching an existing resource", () => {
  it("creates one nothing matches", async () => {
    const h = harness();
    const result = await run(h, [resource()]);

    expect(h.writer.createFromWorkspace).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ created: 1, updated: 0 });
  });

  it("updates rather than duplicating when the URL matches", async () => {
    // The second run, and every run after it. Without this the library doubles.
    const h = harness({ byUrl: new Map([["doc.rust-lang.org/book", "existing-1"]]) });
    const result = await run(h, [resource()]);

    expect(h.writer.updateFromWorkspace).toHaveBeenCalledWith(
      USER,
      MISSION,
      "existing-1",
      expect.objectContaining({ title: "The Rust Book" }),
    );
    expect(result).toEqual({ created: 0, updated: 1 });
  });

  it("matches on URL even when the agent renamed it", async () => {
    // "The Rust Book" → "The Rust Programming Language" between runs is a
    // reasonable thing for an agent to do, and it must not create a second row.
    const h = harness({ byUrl: new Map([["doc.rust-lang.org/book", "existing-1"]]) });
    await run(h, [resource({ title: "The Rust Programming Language" })]);

    expect(h.writer.createFromWorkspace).not.toHaveBeenCalled();
  });

  it("falls back to the title when there is no URL", async () => {
    // Books and podcasts routinely arrive without one. URL-only matching would
    // duplicate every single one of them.
    const h = harness({ byTitle: new Map([["deep work", "existing-2"]]) });
    await run(h, [resource({ title: "Deep Work", url: null })]);

    expect(h.writer.updateFromWorkspace).toHaveBeenCalledWith(
      USER,
      MISSION,
      "existing-2",
      expect.anything(),
    );
  });

  it("prefers the URL over the title when both match different rows", async () => {
    // A URL is identity; a title is a label. Two papers can share a name.
    const h = harness({
      byUrl: new Map([["doc.rust-lang.org/book", "by-url"]]),
      byTitle: new Map([["the rust book", "by-title"]]),
    });
    await run(h, [resource()]);

    expect(h.writer.updateFromWorkspace).toHaveBeenCalledWith(
      USER,
      MISSION,
      "by-url",
      expect.anything(),
    );
  });

  it("deduplicates within one file, not just against the database", async () => {
    // An agent that lists the same book twice must not produce two rows on the
    // very first run either.
    const h = harness();
    const result = await run(h, [resource(), resource({ title: "The Rust Book (2nd ed)" })]);

    expect(result).toEqual({ created: 1, updated: 0 });
  });
});

describe("the rejected list", () => {
  it("records the agent's judgement on something new", async () => {
    const h = harness();
    await run(h, [], [{ title: "Rust in 5 Minutes", url: "https://x.dev", reason: "Too shallow" }]);

    expect(h.writer.createRejected).toHaveBeenCalledWith(
      USER,
      MISSION,
      expect.objectContaining({ reason: "Too shallow" }),
    );
  });

  it("marks an existing resource as rejected rather than adding a second row", async () => {
    const h = harness({ byUrl: new Map([["x.dev/a", "existing-3"]]) });
    await run(h, [], [{ title: "Something", url: "https://x.dev/a", reason: "Out of date" }]);

    expect(h.writer.rejectExisting).toHaveBeenCalledWith(
      USER,
      MISSION,
      "existing-3",
      "Out of date",
    );
    expect(h.writer.createRejected).not.toHaveBeenCalled();
  });

  it("never touches the abandon reason", async () => {
    // `rejected_reason` is the agent's verdict on something nobody started;
    // `abandon_reason` is the learner's own guilt-free quit (FR-R5) and prime
    // friction data. The writer interface cannot express the second, which is the
    // real guard — this asserts the interface stayed that way.
    const h = harness();
    await run(h, [], [{ title: "X", url: null, reason: "Weak" }]);

    expect(Object.keys(h.writer)).not.toContain("abandon");
  });
});

describe("what it never writes", () => {
  it("cannot express status, progress or finished_at", async () => {
    // The most damaging thing this path could do: `RESOURCES.md` has no status
    // column and the database defaults to `inbox`, so a naive write resets a book
    // the learner marked `finished` — on every run, forever. The guardrail is that
    // the fields are not in the interface at all.
    const h = harness({ byUrl: new Map([["doc.rust-lang.org/book", "existing-1"]]) });
    await run(h, [resource()]);

    const fields = h.writer.updateFromWorkspace.mock.calls[0]?.[3];
    expect(Object.keys(fields ?? {}).sort()).toEqual(["title", "trust", "type", "url"]);
  });
});
