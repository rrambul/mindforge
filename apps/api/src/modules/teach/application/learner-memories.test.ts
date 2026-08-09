import { beforeEach, describe, expect, it, vi } from "vitest";

import { LearnerMemories } from "./learner-memories.js";
import type { MemoryFileStore } from "./memory-file.port.js";
import type { LearnerMemoryRepository, LearnerMemoryView } from "./memory.port.js";

/**
 * "The agent writes it; you own it" (§7.6), and the one way that quietly fails.
 *
 * Deleting the row without the file is a delete that undoes itself: files are
 * canonical, so the next run materialises the memory, the agent reads it, and the
 * reindexer puts the row back. The learner sees it disappear and return, having
 * been told nothing.
 */

const USER = "user-1";

/** Fixed, because `new Date()` is banned repo-wide — a test that reads the wall clock fails at midnight. */
const CONFIRMED_AT = new Date("2026-08-08T13:00:00.000Z");

const MEMORY: LearnerMemoryView = {
  id: "memory-1",
  slug: "background",
  kind: "background",
  summary: "Engineer who explains in code",
  writtenBy: "agent",
  confirmedAt: null,
  supersededBySlug: null,
  updatedAt: new Date("2026-08-08T12:00:00.000Z"),
};

function harness(options: { missing?: boolean; removeFails?: boolean } = {}) {
  const memories = {
    saveFromAgent: vi.fn(() => Promise.resolve()),
    markSuperseded: vi.fn(() => Promise.resolve(true)),
    list: vi.fn(() => Promise.resolve([MEMORY])),
    confirm: vi.fn(() =>
      Promise.resolve(options.missing ? null : { ...MEMORY, confirmedAt: CONFIRMED_AT }),
    ),
    forget: vi.fn(() =>
      Promise.resolve(options.missing ? null : { storagePath: `memory/${USER}/background.md` }),
    ),
  } satisfies LearnerMemoryRepository;

  const remove = vi.fn(() =>
    options.removeFails ? Promise.reject(new Error("Storage said no")) : Promise.resolve(),
  );
  const files = { remove } satisfies MemoryFileStore;

  return { memories, remove, use: new LearnerMemories(memories, files) };
}

let h: ReturnType<typeof harness>;

beforeEach(() => {
  h = harness();
});

describe("list", () => {
  it("returns what the agent has concluded", async () => {
    await expect(h.use.list(USER)).resolves.toEqual([MEMORY]);
  });
});

describe("confirm", () => {
  it("records that the learner agreed", async () => {
    const confirmed = await h.use.confirm(USER, "memory-1");

    expect(confirmed.confirmedAt).not.toBeNull();
  });

  it("reports a memory that is not theirs as not found", async () => {
    // RLS makes "not yours" and "does not exist" the same observation, so
    // distinguishing them would confirm somebody else owns this id.
    await expect(harness({ missing: true }).use.confirm(USER, "memory-1")).rejects.toThrow();
  });
});

describe("forget", () => {
  it("deletes the file as well as the row", async () => {
    // Files are canonical (non-negotiable 5). Row-only, the next run materialises
    // the memory from Storage and the reindexer puts the row straight back — a
    // delete that undoes itself, which is worse than none because the learner
    // believes it worked.
    await h.use.forget(USER, "memory-1");

    expect(h.remove).toHaveBeenCalledWith(`memory/${USER}/background.md`);
  });

  it("does not reach for a file when there was no row", async () => {
    const missing = harness({ missing: true });

    await expect(missing.use.forget(USER, "memory-1")).rejects.toThrow();
    expect(missing.remove).not.toHaveBeenCalled();
  });

  it("surfaces a Storage failure rather than reporting success", async () => {
    // The row is already gone, so the learner's intent is recorded — but the file
    // is not, and the next run will recreate the row. Saying "deleted" would make
    // that reappearance inexplicable.
    const failing = harness({ removeFails: true });

    await expect(failing.use.forget(USER, "memory-1")).rejects.toThrow(/Storage said no/u);
  });
});

describe("what it deliberately cannot do", () => {
  it("offers no way to create a memory", () => {
    // §7.6: don't build an onboarding questionnaire. What people say up front
    // about how they learn is usually wrong — the memory is what the agent
    // noticed, and the learner's job is to correct it rather than seed it.
    expect(Object.getOwnPropertyNames(LearnerMemories.prototype)).toEqual([
      "constructor",
      "list",
      "confirm",
      "forget",
    ]);
  });
});
