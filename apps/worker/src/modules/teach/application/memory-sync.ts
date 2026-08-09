import { Inject, Injectable } from "@nestjs/common";

import { memoryPrefix, sha256, type FileState } from "@mindforge/workspace";

import { WORKSPACE_GATEWAY, type RunDirectory, type WorkspaceGateway } from "./workspace.port.js";

/**
 * The learner's cross-mission memory, in and out of a run (§7.6).
 *
 * A second, separate sync — not a corner of the workspace one — because it has a
 * different Storage prefix, a different lifetime, and a different owner.
 * `memory/<user_id>/` spans every mission this person has, which is the whole
 * point: `NOTES.md` is per workspace and cannot tell a Rust mission what a
 * Portuguese one learned about how they like to be taught.
 *
 * It is mounted at `<workspace>/.memory/` for the run, which is also why
 * `.memory` is on the workspace's sync-back exclude list: uploading it into the
 * mission's prefix would give one mission a private copy of a shared thing, and
 * the next mission's run would never see the edit.
 *
 * **Read-write, and that is a deliberate risk.** §7.6's rule is "the agent writes
 * it; you own it" — every write becomes a row the user can read, edit and delete.
 * The alternative, mounting it read-only, would make the memory something only a
 * human could ever fill in, and §7.6 is explicit that an onboarding questionnaire
 * is the wrong answer because what people say up front about how they learn is
 * usually wrong.
 */

/** Where the memory prefix is mounted inside a run's workspace. */
export const MEMORY_MOUNT = ".memory";

export interface MaterializedMemory {
  /** What Storage held when the run started, for the write-back diff. */
  readonly baseline: readonly FileState[];
}

export interface MemorySyncResult {
  /** Files the agent added or changed, relative to the memory prefix. */
  readonly written: readonly string[];
  readonly deleted: readonly string[];
}

@Injectable()
export class MemorySync {
  constructor(@Inject(WORKSPACE_GATEWAY) private readonly gateway: WorkspaceGateway) {}

  /**
   * Storage → `<workspace>/.memory/`.
   *
   * Empty at signup, and that is a legal state rather than a missing one (§7.6:
   * don't build an onboarding questionnaire). The agent gets a directory with
   * nothing in it and the addendum telling it what belongs there.
   */
  async materialize(userId: string, dir: RunDirectory): Promise<MaterializedMemory> {
    const prefix = memoryPrefix(userId);
    const objects = await this.gateway.list(prefix);
    const baseline: FileState[] = [];

    for (const object of objects) {
      const bytes = await this.gateway.download(`${prefix}/${object.path}`);
      await dir.write(`${MEMORY_MOUNT}/${object.path}`, bytes);

      baseline.push({
        path: object.path,
        contentHash: sha256(bytes),
        sizeBytes: bytes.byteLength,
        storageEtag: object.etag,
        storageVersion: object.version ?? null,
      });
    }

    return { baseline };
  }

  /**
   * `<workspace>/.memory/` → Storage.
   *
   * **Deletions are not carried out.** §7.6 says supersede, never mutate — that a
   * stated preference changed is itself the information, and an agent that
   * "tidied up" by removing a memory would erase the record of having believed
   * something. The row it produced stays too; the user is the only one who
   * deletes.
   *
   * A file the agent removed is therefore restored rather than dropped: the next
   * run materialises it again, which is the honest consequence of the memory
   * belonging to the learner rather than to any one run.
   */
  async syncBack(input: {
    readonly userId: string;
    readonly dir: RunDirectory;
    readonly baseline: readonly FileState[];
  }): Promise<MemorySyncResult> {
    const prefix = memoryPrefix(input.userId);
    const before = new Map(input.baseline.map((file) => [file.path, file.contentHash]));

    const current = await this.readMounted(input.dir);
    const written: string[] = [];

    for (const [path, bytes] of current) {
      const hash = sha256(bytes);
      if (before.get(path) === hash) continue;

      await this.gateway.upload(`${prefix}/${path}`, bytes, "text/markdown; charset=utf-8");
      written.push(path);
    }

    // Reported so the run's result can say it happened, and then ignored. See
    // the doc comment: the agent does not get to forget things on the learner's
    // behalf.
    const deleted = [...before.keys()].filter((path) => !current.has(path));

    return { written, deleted };
  }

  /** Everything under the mount, keyed relative to the memory prefix. */
  private async readMounted(dir: RunDirectory): Promise<Map<string, Uint8Array>> {
    const found = new Map<string, Uint8Array>();

    // `walkUnder` rather than `walk`, because `walk` excludes `.memory` — that
    // exclusion is about where the files may be uploaded, not about whether they
    // can be read.
    for (const file of await dir.walkUnder(MEMORY_MOUNT)) {
      if (!file.path.endsWith(".md")) continue;
      found.set(file.path.slice(MEMORY_MOUNT.length + 1), file.bytes);
    }

    return found;
  }
}
