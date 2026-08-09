import { Inject, Injectable, Logger } from "@nestjs/common";

import { AgentRunNotFound } from "../domain/errors.js";
import { MEMORY_FILE_STORE, type MemoryFileStore } from "./memory-file.port.js";
import {
  LEARNER_MEMORY_REPOSITORY,
  type LearnerMemoryRepository,
  type LearnerMemoryView,
} from "./memory.port.js";

/**
 * Reading and correcting what the agent concluded about you (§7.6).
 *
 * There is no `create`. §7.6 is explicit that an onboarding questionnaire is the
 * wrong answer, because the answers people give up front about how they learn are
 * usually wrong — the memory is bootstrapped by the agent noticing things across
 * a few sessions, and the learner's job is to correct it rather than to seed it.
 *
 * Two verbs, and they are not symmetrical:
 *
 * - **Confirm** is the learner agreeing with an inference. Worth recording because
 *   silence is not agreement, and a confirmed memory is one the agent can lean on
 *   harder than one it guessed last Tuesday.
 * - **Forget** deletes outright, file and row. Not a supersession — that is what
 *   the *agent* does when it changes its mind, and the record of having believed
 *   something is worth keeping. A memory the learner rejects is a different thing:
 *   it is wrong, and it is replayed verbatim into every future run on every
 *   mission, so a tombstone would keep feeding it back.
 */
@Injectable()
export class LearnerMemories {
  private readonly logger = new Logger(LearnerMemories.name);

  constructor(
    @Inject(LEARNER_MEMORY_REPOSITORY) private readonly memories: LearnerMemoryRepository,
    @Inject(MEMORY_FILE_STORE) private readonly files: MemoryFileStore,
  ) {}

  list(userId: string): Promise<readonly LearnerMemoryView[]> {
    return this.memories.list(userId);
  }

  async confirm(userId: string, id: string): Promise<LearnerMemoryView> {
    const confirmed = await this.memories.confirm(userId, id);
    // Reusing the run's not-found error rather than inventing a second: RLS makes
    // "not yours" and "does not exist" the same observation either way, and the
    // SPA needs one branch, not two.
    if (!confirmed) throw new AgentRunNotFound(id);
    return confirmed;
  }

  async forget(userId: string, id: string): Promise<void> {
    const forgotten = await this.memories.forget(userId, id);
    if (!forgotten) throw new AgentRunNotFound(id);

    // **The file, not just the row.** Files are canonical (non-negotiable 5), so
    // deleting the index alone leaves the memory in Storage — where the next run
    // materialises it, the agent reads it, and the reindexer puts the row back.
    // A delete that undoes itself is worse than no delete at all, because the
    // learner believes it worked.
    try {
      await this.files.remove(forgotten.storagePath);
    } catch (error) {
      // The row is already gone, so the learner's intent is recorded and the
      // memory is out of the review screen. Logged rather than rethrown because
      // failing here would leave them unable to remove something they have
      // explicitly rejected — and the next run's reindex will recreate the row,
      // which is visible, rather than silently keeping it.
      this.logger.error(
        `Deleted memory ${id} but could not remove ${forgotten.storagePath}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
