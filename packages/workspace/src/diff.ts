/**
 * What changed in a workspace while the agent had it (§7.4 step 2).
 *
 * A pure comparison of two file listings. The interesting decisions are about
 * what counts as a change and what counts as a conflict, and they are different
 * questions with different answers:
 *
 * - **A change** is "this file's bytes differ from the baseline we downloaded".
 *   Decided entirely from our own sha256, and always correct.
 *
 * - **A conflict** is "Storage's copy has moved since we downloaded it", which
 *   means somebody else wrote — a local `/teach` push, or an edit in the UI.
 *   Decided from the ETag or version we re-list before uploading, and detectable
 *   rather than preventable: Storage has no conditional write, so this catches
 *   the other writer without excluding them.
 */

export type ChangeKind = "added" | "modified" | "deleted" | "unchanged";

export interface FileState {
  /** Relative to the workspace root: `lessons/0007-closures.html`. */
  readonly path: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  /** As recorded at materialise time, for the conflict check. */
  readonly storageEtag?: string | null;
  readonly storageVersion?: string | null;
}

export interface Change {
  readonly path: string;
  readonly kind: ChangeKind;
  /** Present unless the file was deleted. */
  readonly current?: FileState;
  /** Present unless the file was added. */
  readonly baseline?: FileState;
}

function index(files: readonly FileState[]): Map<string, FileState> {
  return new Map(files.map((file) => [file.path, file]));
}

/**
 * Compare the workspace on disk against what was downloaded.
 *
 * `unchanged` entries are returned rather than filtered, because the caller needs
 * them: `workspace_files` rows for untouched files still have to survive the
 * sync, and a diff that only reports changes makes "absent from the diff"
 * ambiguous between "unchanged" and "deleted".
 */
export function diffWorkspace(
  baseline: readonly FileState[],
  current: readonly FileState[],
): readonly Change[] {
  const before = index(baseline);
  const after = index(current);
  const changes: Change[] = [];

  for (const [path, file] of after) {
    const previous = before.get(path);

    if (!previous) {
      changes.push({ path, kind: "added", current: file });
    } else if (previous.contentHash !== file.contentHash) {
      changes.push({ path, kind: "modified", current: file, baseline: previous });
    } else {
      changes.push({ path, kind: "unchanged", current: file, baseline: previous });
    }
  }

  for (const [path, file] of before) {
    if (!after.has(path)) changes.push({ path, kind: "deleted", baseline: file });
  }

  // Sorted so a run's recorded changes are stable between runs and diffable in a
  // review. Nothing downstream depends on the order, which is the point: an
  // unstable order would make two identical runs look different.
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Changes that need Storage touched. `unchanged` files are not re-uploaded. */
export function writableChanges(changes: readonly Change[]): readonly Change[] {
  return changes.filter((change) => change.kind !== "unchanged");
}

export interface ConflictCheckInput {
  readonly change: Change;
  /** What Storage reports *now*, from the re-list before upload. */
  readonly currentEtag: string | null;
  readonly currentVersion: string | null;
}

export interface Conflict {
  readonly path: string;
  readonly reason: "changed_in_storage" | "deleted_in_storage";
}

/**
 * Which of the writes we are about to make would clobber somebody else's.
 *
 * **Version beats ETag when both are available.** The ETag is `md5(content)`, so
 * a byte-identical rewrite by another writer leaves it unchanged and this check
 * blind; `version` is a fresh UUID on every write, including that one. Falling
 * back to the ETag matters anyway, since `list()` gives one cheaply and `info()`
 * is a request per object.
 *
 * A file we added and Storage now also has is a conflict too — two writers
 * created the same lesson number, and picking either silently loses one.
 */
export function detectConflicts(inputs: readonly ConflictCheckInput[]): readonly Conflict[] {
  const conflicts: Conflict[] = [];

  for (const { change, currentEtag, currentVersion } of inputs) {
    if (change.kind === "unchanged") continue;

    const recorded = change.baseline ?? change.current;

    if (change.kind === "added") {
      // Nothing was there when we listed. Anything there now arrived since.
      if (currentEtag !== null || currentVersion !== null) {
        conflicts.push({ path: change.path, reason: "changed_in_storage" });
      }
      continue;
    }

    if (currentEtag === null && currentVersion === null) {
      // We are about to modify or delete a file Storage no longer has. For a
      // delete that is agreement; for a modify it is somebody else's delete, and
      // silently re-creating the file would undo it.
      if (change.kind === "modified") {
        conflicts.push({ path: change.path, reason: "deleted_in_storage" });
      }
      continue;
    }

    const versionMoved =
      recorded?.storageVersion != null &&
      currentVersion !== null &&
      recorded.storageVersion !== currentVersion;

    const etagMoved =
      !versionMoved &&
      recorded?.storageEtag != null &&
      currentEtag !== null &&
      normalize(recorded.storageEtag) !== normalize(currentEtag);

    if (versionMoved || etagMoved) {
      conflicts.push({ path: change.path, reason: "changed_in_storage" });
    }
  }

  return conflicts;
}

function normalize(etag: string): string {
  return etag.trim().replace(/^W\//u, "").replace(/^"|"$/gu, "");
}

/**
 * Where the incoming write lands when its target is contested.
 *
 * Both versions are retained and neither is resolved (non-negotiable 6). The
 * timestamp is a parameter rather than read from the clock because `new Date()`
 * is banned in this repo's tests for exactly this reason — a filename that
 * depends on the wall clock is a filename no test can assert on.
 */
export function conflictPathFor(path: string, at: Date): string {
  return `${path}.conflict-${at.toISOString().replace(/[:.]/gu, "-")}`;
}
