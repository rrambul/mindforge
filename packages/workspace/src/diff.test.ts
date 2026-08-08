import { describe, expect, it } from "vitest";

import {
  conflictPathFor,
  detectConflicts,
  diffWorkspace,
  writableChanges,
  type FileState,
} from "./diff.js";
import { etagsMatch, normalizeEtag, sha256, storageEtag } from "./hash.js";

function file(path: string, hash: string, extra: Partial<FileState> = {}): FileState {
  return { path, contentHash: hash, sizeBytes: hash.length, ...extra };
}

describe("diffWorkspace", () => {
  it("classifies added, modified, deleted and unchanged", () => {
    const changes = diffWorkspace(
      [file("MISSION.md", "a"), file("NOTES.md", "b"), file("gone.md", "c")],
      [file("MISSION.md", "a"), file("NOTES.md", "B"), file("lessons/0001-x.html", "d")],
    );

    // Keyed rather than positional: the ordering is a separate property with its
    // own test below, and asserting it here would make this fail for the wrong
    // reason the first time the sort changes.
    expect(Object.fromEntries(changes.map((c) => [c.path, c.kind]))).toEqual({
      "MISSION.md": "unchanged",
      "NOTES.md": "modified",
      "gone.md": "deleted",
      "lessons/0001-x.html": "added",
    });
  });

  it("reports unchanged files rather than filtering them", () => {
    // The caller needs them: workspace_files rows for untouched files still have
    // to survive the sync, and a diff that only reports changes makes "absent
    // from the diff" ambiguous between unchanged and deleted.
    const changes = diffWorkspace([file("MISSION.md", "a")], [file("MISSION.md", "a")]);

    expect(changes).toHaveLength(1);
    expect(writableChanges(changes)).toHaveLength(0);
  });

  it("sorts by path, so two identical runs produce an identical record", () => {
    const changes = diffWorkspace([], [file("z.md", "1"), file("a.md", "2")]);

    expect(changes.map((c) => c.path)).toEqual(["a.md", "z.md"]);
  });

  it("handles an empty workspace on either side", () => {
    expect(diffWorkspace([], [])).toEqual([]);
    expect(diffWorkspace([file("a", "1")], [])).toHaveLength(1);
  });
});

describe("detectConflicts", () => {
  const baseline = file("lessons/0007-x.html", "local-hash", {
    storageEtag: '"aaa"',
    storageVersion: "v1",
  });
  const modified = { path: baseline.path, kind: "modified" as const, baseline, current: baseline };

  it("passes when Storage has not moved since we downloaded it", () => {
    expect(
      detectConflicts([{ change: modified, currentEtag: '"aaa"', currentVersion: "v1" }]),
    ).toEqual([]);
  });

  it("flags a file somebody else wrote while the agent had it", () => {
    expect(
      detectConflicts([{ change: modified, currentEtag: '"bbb"', currentVersion: "v2" }]),
    ).toEqual([{ path: baseline.path, reason: "changed_in_storage" }]);
  });

  it("catches a byte-identical rewrite that the ETag cannot see", () => {
    // The whole reason `version` is stored beside the ETag. An ETag is
    // md5(content), so another writer saving the same bytes leaves it untouched —
    // and "somebody else is writing this workspace" is exactly what we need to
    // know, whether or not their write changed anything.
    expect(
      detectConflicts([{ change: modified, currentEtag: '"aaa"', currentVersion: "v2" }]),
    ).toEqual([{ path: baseline.path, reason: "changed_in_storage" }]);
  });

  it("falls back to the ETag when no version was recorded", () => {
    // `list()` gives an ETag for the whole prefix in one request; `info()` is a
    // request per object. The cheap path has to work.
    const etagOnly = { ...modified, baseline: file(baseline.path, "h", { storageEtag: '"aaa"' }) };

    expect(
      detectConflicts([{ change: etagOnly, currentEtag: '"bbb"', currentVersion: null }]),
    ).toEqual([{ path: baseline.path, reason: "changed_in_storage" }]);
  });

  it("ignores ETag quoting and weak-validator prefixes", () => {
    const etagOnly = { ...modified, baseline: file(baseline.path, "h", { storageEtag: "aaa" }) };

    expect(
      detectConflicts([{ change: etagOnly, currentEtag: 'W/"aaa"', currentVersion: null }]),
    ).toEqual([]);
  });

  it("flags an add whose path somebody else has already created", () => {
    // Two writers produced the same lesson number. Picking either silently loses
    // one, which is the failure non-negotiable 6 exists to prevent.
    const added = { path: "lessons/0008-y.html", kind: "added" as const, current: baseline };

    expect(
      detectConflicts([{ change: added, currentEtag: '"zzz"', currentVersion: "v9" }]),
    ).toEqual([{ path: "lessons/0008-y.html", reason: "changed_in_storage" }]);
  });

  it("allows an add to a path Storage does not have", () => {
    const added = { path: "lessons/0008-y.html", kind: "added" as const, current: baseline };

    expect(detectConflicts([{ change: added, currentEtag: null, currentVersion: null }])).toEqual(
      [],
    );
  });

  it("flags a modify to a file somebody else deleted", () => {
    // Re-uploading would silently undo their delete.
    expect(
      detectConflicts([{ change: modified, currentEtag: null, currentVersion: null }]),
    ).toEqual([{ path: baseline.path, reason: "deleted_in_storage" }]);
  });

  it("treats a delete of an already-deleted file as agreement", () => {
    const deleted = { path: baseline.path, kind: "deleted" as const, baseline };

    expect(detectConflicts([{ change: deleted, currentEtag: null, currentVersion: null }])).toEqual(
      [],
    );
  });

  it("never flags an unchanged file", () => {
    const unchanged = {
      path: baseline.path,
      kind: "unchanged" as const,
      baseline,
      current: baseline,
    };

    expect(
      detectConflicts([{ change: unchanged, currentEtag: '"different"', currentVersion: "v9" }]),
    ).toEqual([]);
  });
});

describe("conflictPathFor", () => {
  it("puts the incoming write beside the original rather than over it", () => {
    expect(conflictPathFor("lessons/0007-x.html", new Date("2026-08-08T12:00:00.000Z"))).toBe(
      "lessons/0007-x.html.conflict-2026-08-08T12-00-00-000Z",
    );
  });

  it("takes the timestamp as a parameter, so a test can assert on the name", () => {
    // `new Date()` is banned in this repo's tests for exactly this reason: a
    // filename that depends on the wall clock is a filename nothing can pin.
    const at = new Date("2026-01-01T00:00:00.000Z");

    expect(conflictPathFor("a.md", at)).toBe(conflictPathFor("a.md", at));
  });
});

describe("hashing", () => {
  it("computes the ETag Storage would report, quotes included", () => {
    // Probed: an ETag on a single-part upload is md5(content), and Storage
    // returns it quoted. Comparing a quoted value with an unquoted one mismatches
    // on every file, which reads as "somebody else wrote this" and turns every
    // sync into a conflict.
    expect(storageEtag("hello")).toBe('"5d41402abc4b2a76b9719d911017c592"');
  });

  it("hashes content with sha256 for our own ledger", () => {
    expect(sha256("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("normalises quoting and weak validators before comparing", () => {
    expect(normalizeEtag('"abc"')).toBe("abc");
    expect(normalizeEtag('W/"abc"')).toBe("abc");
    expect(normalizeEtag(null)).toBeNull();
    expect(normalizeEtag("")).toBeNull();
  });

  it("treats two absent ETags as not matching", () => {
    // "Neither of us knows" is not "they agree". Returning true here would let a
    // concurrent write through on any object Storage declined to describe.
    expect(etagsMatch(null, null)).toBe(false);
    expect(etagsMatch('"a"', '"a"')).toBe(true);
    expect(etagsMatch('"a"', '"b"')).toBe(false);
  });
});
