import { memoryPrefix, parseLearnerMemory, sha256, type ParseWarning } from "@mindforge/workspace";
import { Inject, Injectable } from "@nestjs/common";

import {
  LEARNER_MEMORY_REPOSITORY,
  type IndexedMemory,
  type LearnerMemoryRepository,
} from "./memory.port.js";

/**
 * `memory/<user_id>/*.md` → `learner_memories` (§7.6).
 *
 * Separate from `ReindexWorkspace` because memory is per **user**, not per
 * mission. A run touches one mission's workspace and the learner's whole memory,
 * and folding the second into the first would key it by a mission it does not
 * belong to.
 *
 * ### The row exists so the user can argue with it
 *
 * §7.6's rule is "the agent writes it; you own it". A model that silently
 * accumulates conclusions about somebody is a trust problem, and a wrong entry
 * poisons every future lesson on every mission — the memory is replayed verbatim
 * into every run. So the index is not a cache: it is the surface the review
 * screen reads, and it is why `written_by` distinguishes an inference from
 * something the learner typed, and `confirmed_at` distinguishes an inference
 * they have since agreed with.
 *
 * ### Supersede, never mutate
 *
 * A correction points forward to its replacement rather than overwriting it.
 * Seeing that a stated preference changed is the information — a learner who
 * used to want analogies and now does not has told you two things, and only one
 * of them survives an overwrite.
 */

export interface ReindexMemoryInput {
  readonly userId: string;
  /** Path relative to the memory prefix → bytes. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export interface ReindexMemoryResult {
  readonly indexed: number;
  readonly superseded: number;
  readonly warnings: readonly ParseWarning[];
}

@Injectable()
export class ReindexLearnerMemory {
  constructor(
    @Inject(LEARNER_MEMORY_REPOSITORY) private readonly memories: LearnerMemoryRepository,
  ) {}

  async execute(input: ReindexMemoryInput): Promise<ReindexMemoryResult> {
    const warnings: ParseWarning[] = [];
    const decoder = new TextDecoder();
    const prefix = memoryPrefix(input.userId);

    const parsed: IndexedMemory[] = [];
    const supersessions: { readonly slug: string; readonly supersedes: string }[] = [];

    for (const [path, bytes] of input.files) {
      if (!path.endsWith(".md")) continue;

      const result = parseLearnerMemory(path, decoder.decode(bytes));
      warnings.push(...result.warnings);

      parsed.push({
        slug: result.parsed.slug,
        kind: result.parsed.kind,
        summary: result.parsed.summary,
        storagePath: `${prefix}/${path}`,
        contentHash: sha256(bytes),
      });

      if (result.parsed.supersedes !== null) {
        supersessions.push({ slug: result.parsed.slug, supersedes: result.parsed.supersedes });
      }
    }

    // Upsert on `(user_id, slug)`, which is a real unique constraint — unlike
    // `resources`, this one did not have to be invented. Written by the agent, so
    // `written_by` stays `agent` and `confirmed_at` is untouched: a run must not
    // be able to mark its own inference as user-confirmed.
    await this.memories.saveFromAgent(input.userId, parsed);

    // Two passes, for the reason the learning records need two: a memory can
    // supersede one this same run wrote, and there is no id to point at until
    // both rows exist.
    let superseded = 0;
    for (const link of supersessions) {
      if (await this.memories.markSuperseded(input.userId, link.supersedes, link.slug)) {
        superseded += 1;
      } else {
        // The named memory does not exist. Warned rather than ignored: the agent
        // believes it corrected something, and a supersession pointing at nothing
        // means the old belief is still being replayed into every run.
        warnings.push({
          code: "link_unresolved",
          args: { from: link.slug, to: link.supersedes },
        });
      }
    }

    return { indexed: parsed.length, superseded, warnings };
  }
}
