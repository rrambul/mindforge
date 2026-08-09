import type { FileState, ObjectStore } from "@mindforge/workspace";

/**
 * What the workspace sync needs beyond `@mindforge/workspace`'s own ports.
 *
 * `ObjectStore` and `FileTree` are declared there because they are part of what
 * the sync protocol *is*. The ledger is declared here because it is Postgres, and
 * `packages/workspace` holds no persistence.
 *
 * One wide port rather than three narrow ones, for the reason `nightly.port.ts`
 * gives: the worker has no bounded contexts to protect from each other, and the
 * thing worth buying is that the whole run is testable against an in-memory
 * double with no Postgres, no Storage and no disk.
 */

export const WORKSPACE_GATEWAY = Symbol("WorkspaceGateway");

/** A run's temp directory, opened and torn down by the caller. */
export interface RunDirectory {
  readonly root: string;
  /** Every file under the root, with Mindforge's scaffolding already excluded. */
  walk(): Promise<readonly { readonly path: string; readonly bytes: Uint8Array }[]>;

  /**
   * Every file under one subtree, **unfiltered**.
   *
   * `.memory/` is excluded from `walk()` so it cannot be uploaded into a
   * mission's Storage prefix — it belongs to the learner rather than to any one
   * mission (§7.6). That exclusion is about where the files go, not about whether
   * they can be read, so the memory sync asks for its own subtree explicitly.
   *
   * Two methods rather than a flag, because a boolean here would be a switch that
   * turns the mission sync's guardrail off, and the only correct value for that
   * call is the one it already has.
   */
  walkUnder(
    prefix: string,
  ): Promise<readonly { readonly path: string; readonly bytes: Uint8Array }[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  dispose(): Promise<void>;
}

export interface WorkspaceGateway extends ObjectStore {
  /**
   * Create a temp directory for one run.
   *
   * Ephemeral by design (§7.3): Railway's filesystem does not survive a deploy,
   * and materialise → run → sync → delete is the shape that makes that fine
   * rather than a problem.
   */
  openRunDirectory(runId: string): Promise<RunDirectory>;

  /**
   * The ledger as it stood after the last sync.
   *
   * `userId` first, and not optional — the worker bypasses RLS, so this
   * signature is the enforcement (CLAUDE.md's first non-negotiable).
   */
  readLedger(userId: string, missionId: string): Promise<readonly FileState[]>;

  /**
   * Replace the ledger for a mission.
   *
   * Delete-then-insert over the whole mission rather than an upsert per path, for
   * the same reason `daily_activity` rebuilds a range: an upsert can only ever
   * revise a row, and a file that was deleted has to make its row disappear.
   */
  writeLedger(userId: string, missionId: string, files: readonly FileState[]): Promise<void>;
}
