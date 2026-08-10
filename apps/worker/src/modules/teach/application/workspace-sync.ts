import { contentTypeFor } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";

import {
  conflictPathFor,
  detectConflicts,
  diffWorkspace,
  isConflictCopy,
  sha256,
  workspacePrefix,
  writableChanges,
  type Change,
  type Conflict,
  type FileState,
  type StoredObject,
} from "@mindforge/workspace";

import { CLOCK, type Clock } from "../../../shared/clock.js";
import { WORKSPACE_GATEWAY, type RunDirectory, type WorkspaceGateway } from "./workspace.port.js";

/**
 * Storage ↔ disk, both directions (§7.4).
 *
 * Files are canonical and Postgres is a rebuildable index (non-negotiable 5), so
 * everything here is arranged around not losing a file. The two rules that shape
 * it:
 *
 * **Conflicts are detected, never prevented.** Supabase Storage has no
 * conditional write — a `PUT` with a wrong `If-Match` returns 200 and overwrites
 * — so there is a real window between the check and the write that nothing at
 * the Storage layer closes. What makes that survivable is retention: the
 * incoming write lands beside the existing file at `<path>.conflict-<ts>`, both
 * versions survive, and a human decides. The single-active-run index on
 * `agent_runs` is what prevents *our own* concurrency; this catches the other
 * writer — a local `/teach` push, or an edit made in the UI.
 *
 * **The exclude list is applied at the walk.** `RunDirectory.walk()` never
 * returns `BRIEFING.md` or the skill's format docs, so they cannot enter the diff
 * at all. Excluding them only from the upload would leave them in the baseline,
 * and they would diff as `deleted` on the next run.
 */

export interface MaterializedWorkspace {
  readonly dir: RunDirectory;
  /** What Storage held at materialise time. The conflict check compares against this. */
  readonly baseline: readonly FileState[];
}

export interface SyncResult {
  readonly changes: readonly Change[];
  readonly conflicts: readonly Conflict[];
  /** What the ledger now says, which is what the next run will diff against. */
  readonly ledger: readonly FileState[];
}

@Injectable()
export class WorkspaceSync {
  constructor(
    @Inject(WORKSPACE_GATEWAY) private readonly gateway: WorkspaceGateway,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Storage → disk.
   *
   * Lists first and downloads second, which is not an optimisation: the download
   * returns a Blob and discards response headers, so the ETag can only come from
   * the listing. §7.4 used to describe it the other way round.
   */
  async materialize(input: {
    readonly runId: string;
    readonly userId: string;
    readonly workspaceKey: string;
  }): Promise<MaterializedWorkspace> {
    const prefix = workspacePrefix(input.userId, input.workspaceKey);
    const objects = await this.gateway.list(prefix);
    const dir = await this.gateway.openRunDirectory(input.runId);

    const baseline: FileState[] = [];

    for (const object of objects) {
      // A retained conflict copy is not part of the workspace. Downloading it
      // would put it in the baseline, and it would then be indexed — where its
      // filename parses to a lesson number that already exists.
      if (isConflictCopy(object.path)) continue;

      const bytes = await this.gateway.download(`${prefix}/${object.path}`);
      await dir.write(object.path, bytes);

      baseline.push({
        path: object.path,
        contentHash: sha256(bytes),
        sizeBytes: bytes.byteLength,
        storageEtag: object.etag,
        storageVersion: object.version ?? null,
      });
    }

    return { dir, baseline };
  }

  /**
   * Disk → Storage.
   *
   * Re-lists twice: once before writing, to see whether anybody else has, and
   * once after, because the upload response carries no ETag and the ledger needs
   * one for the next run's comparison.
   */
  async syncBack(input: {
    readonly userId: string;
    readonly missionId: string;
    readonly workspaceKey: string;
    readonly dir: RunDirectory;
    readonly baseline: readonly FileState[];
  }): Promise<SyncResult> {
    const prefix = workspacePrefix(input.userId, input.workspaceKey);

    const current = (await input.dir.walk()).map((file): FileState => ({
      path: file.path,
      contentHash: sha256(file.bytes),
      sizeBytes: file.bytes.byteLength,
    }));

    const changes = diffWorkspace(input.baseline, current);
    const writable = writableChanges(changes);

    if (writable.length === 0) {
      return { changes, conflicts: [], ledger: [...input.baseline] };
    }

    const before = indexByPath(await this.gateway.list(prefix));
    const conflicts = detectConflicts(
      writable.map((change) => ({
        change,
        currentEtag: before.get(change.path)?.etag ?? null,
        currentVersion: before.get(change.path)?.version ?? null,
      })),
    );
    const contested = new Set(conflicts.map((conflict) => conflict.path));

    const at = this.clock.now();
    const removals: string[] = [];

    for (const change of writable) {
      if (change.kind === "deleted") {
        // A contested delete is not carried out. Removing a file somebody else
        // has just written is the one operation retention cannot undo.
        if (!contested.has(change.path)) removals.push(`${prefix}/${change.path}`);
        continue;
      }

      const bytes = await input.dir.read(change.path);
      // Contested writes land beside the existing file rather than over it. Both
      // versions survive and a human decides (non-negotiable 6).
      const target = contested.has(change.path) ? conflictPathFor(change.path, at) : change.path;

      await this.gateway.upload(`${prefix}/${target}`, bytes, contentTypeFor(target));
    }

    if (removals.length > 0) await this.gateway.remove(removals);

    // The upload response carries no ETag, so the values the next run compares
    // against can only come from listing again.
    const after = indexByPath(await this.gateway.list(prefix));
    const ledger = current
      .filter((file) => !contested.has(file.path) || after.has(file.path))
      .map((file): FileState => ({
        ...file,
        storageEtag: after.get(file.path)?.etag ?? null,
        storageVersion: after.get(file.path)?.version ?? null,
      }));

    await this.gateway.writeLedger(input.userId, input.missionId, ledger);

    return { changes, conflicts, ledger };
  }
}

function indexByPath(objects: readonly StoredObject[]): Map<string, StoredObject> {
  return new Map(objects.map((object) => [object.path, object]));
}
