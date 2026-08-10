import { beforeEach, describe, expect, it } from "vitest";

import type { IndexedMemory, LearnerMemoryRepository, LearnerMemoryView } from "./memory.port.js";
import { ReindexLearnerMemory } from "./reindex-memory.js";

const ALICE = "11111111-1111-4111-8111-111111111111";

const encoder = new TextEncoder();
const files = (entries: Record<string, string>): ReadonlyMap<string, Uint8Array> =>
  new Map(Object.entries(entries).map(([path, text]) => [path, encoder.encode(text)]));

const MEMORY = `# Prefers worked examples over analogies

Kind: teaching_preference

Detail the runs can read.
`;

class FakeMemories implements LearnerMemoryRepository {
  saved: IndexedMemory[] = [];
  /** Slugs that exist, for supersession lookups. */
  readonly known = new Set<string>();
  readonly superseded: { readonly from: string; readonly to: string }[] = [];

  saveFromAgent(_userId: string, memories: readonly IndexedMemory[]): Promise<void> {
    this.saved.push(...memories);
    for (const memory of memories) this.known.add(memory.slug);
    return Promise.resolve();
  }

  markSuperseded(_userId: string, supersededSlug: string, replacementSlug: string) {
    if (!this.known.has(supersededSlug)) return Promise.resolve(false);
    this.superseded.push({ from: replacementSlug, to: supersededSlug });
    return Promise.resolve(true);
  }

  list(): Promise<readonly LearnerMemoryView[]> {
    return Promise.resolve([]);
  }

  confirm(): Promise<LearnerMemoryView | null> {
    return Promise.resolve(null);
  }

  forget(): Promise<{ readonly storagePath: string } | null> {
    return Promise.resolve(null);
  }
}

describe("ReindexLearnerMemory", () => {
  let memories: FakeMemories;
  let reindex: ReindexLearnerMemory;

  beforeEach(() => {
    memories = new FakeMemories();
    reindex = new ReindexLearnerMemory(memories);
  });

  it("indexes each markdown file under the user's own prefix", async () => {
    const result = await reindex.execute({
      userId: ALICE,
      files: files({ "prefers-worked-examples.md": MEMORY }),
    });

    expect(result.indexed).toBe(1);
    expect(memories.saved[0]).toMatchObject({
      slug: "prefers-worked-examples",
      kind: "teaching_preference",
      summary: "Prefers worked examples over analogies",
      storagePath: `memory/${ALICE}/prefers-worked-examples.md`,
    });
    expect(memories.saved[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores anything that is not markdown", async () => {
    const result = await reindex.execute({
      userId: ALICE,
      files: files({ ".DS_Store": "junk", "notes.txt": "also junk" }),
    });

    expect(result.indexed).toBe(0);
    expect(memories.saved).toEqual([]);
  });

  it("links a supersession once both rows exist", async () => {
    // Two passes, for the reason the learning records need two: a memory can
    // supersede one this same run wrote.
    const result = await reindex.execute({
      userId: ALICE,
      files: files({
        "old-preference.md": MEMORY,
        "new-preference.md": `# Now prefers analogies\n\nKind: teaching_preference\nSupersedes: old-preference\n\nChanged their mind.\n`,
      }),
    });

    expect(result.superseded).toBe(1);
    expect(memories.superseded).toEqual([{ from: "new-preference", to: "old-preference" }]);
  });

  it("warns when a supersession points at nothing", async () => {
    // The agent believes it corrected something, and the old belief is still
    // being replayed into every run — that is worth a warning, not silence.
    const result = await reindex.execute({
      userId: ALICE,
      files: files({
        "new-preference.md": `# Now prefers analogies\n\nKind: teaching_preference\nSupersedes: never-existed\n\nChanged their mind.\n`,
      }),
    });

    expect(result.superseded).toBe(0);
    expect(result.warnings.map((w) => w.code)).toContain("link_unresolved");
  });

  it("collects parse warnings rather than failing the run", async () => {
    const result = await reindex.execute({
      userId: ALICE,
      files: files({ "mystery.md": "no kind, no heading" }),
    });

    expect(result.indexed).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
