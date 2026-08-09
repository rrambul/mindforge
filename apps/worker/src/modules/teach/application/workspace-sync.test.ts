import { FixedClock } from "@mindforge/core";
import { isExcludedFromSync, storageEtag, type FileState } from "@mindforge/workspace";
import { beforeEach, describe, expect, it } from "vitest";

import { WorkspaceSync } from "./workspace-sync.js";
import type { RunDirectory, WorkspaceGateway } from "./workspace.port.js";

/**
 * The sync protocol against an in-memory Storage and an in-memory disk.
 *
 * Doubles rather than the real stack because the interesting cases are the ones
 * that are hard to arrange for real: somebody else writing between our list and
 * our upload, a byte-identical rewrite by another writer, a delete racing a
 * modify. The gateway integration test covers that the adapter speaks Storage
 * correctly; this covers whether the protocol is right.
 */

const USER = "user-1";
const MISSION = "mission-1";
const KEY = "rust";
const PREFIX = `workspaces/${USER}/${KEY}`;
const AT = new Date("2026-08-08T12:00:00.000Z");

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

/** Storage, with the two properties the protocol actually leans on. */
class FakeStorage {
  readonly objects = new Map<string, { bytes: Uint8Array; version: number }>();
  private nextVersion = 1;

  put(path: string, content: string): void {
    this.objects.set(path, { bytes: bytes(content), version: this.nextVersion++ });
  }
}

class FakeDisk implements RunDirectory {
  readonly root = "/tmp/fake";
  readonly files = new Map<string, Uint8Array>();
  disposed = false;

  walk() {
    // The exclusion belongs at the walk, and this double honours that rather
    // than reimplementing it — a test that filtered somewhere else would prove
    // the wrong thing.
    return Promise.resolve(
      [...this.files.entries()]
        .filter(([path]) => !isExcludedFromSync(path))
        .map(([path, content]) => ({ path, bytes: content })),
    );
  }

  walkUnder(prefix: string) {
    // Unfiltered, unlike `walk`. `.memory` belongs to the learner rather than to
    // a mission, so it is excluded from the sync-back walk and read explicitly.
    return Promise.resolve(
      [...this.files.entries()]
        .filter(([path]) => path.startsWith(`${prefix}/`))
        .map(([path, content]) => ({ path, bytes: content })),
    );
  }

  read(path: string) {
    const found = this.files.get(path);
    if (!found) return Promise.reject(new Error(`no such file: ${path}`));
    return Promise.resolve(found);
  }

  write(path: string, content: Uint8Array) {
    this.files.set(path, content);
    return Promise.resolve();
  }

  dispose() {
    this.disposed = true;
    return Promise.resolve();
  }
}

function gatewayOver(storage: FakeStorage, disk: FakeDisk) {
  const ledgers = new Map<string, readonly FileState[]>();

  const gateway: WorkspaceGateway = {
    list(prefix) {
      return Promise.resolve(
        [...storage.objects.entries()]
          .filter(([path]) => path.startsWith(`${prefix}/`))
          .map(([path, object]) => ({
            path: path.slice(prefix.length + 1),
            sizeBytes: object.bytes.byteLength,
            etag: storageEtag(object.bytes),
            version: `v${object.version}`,
          })),
      );
    },
    download(path) {
      const found = storage.objects.get(path);
      if (!found) return Promise.reject(new Error(`no such object: ${path}`));
      return Promise.resolve(found.bytes);
    },
    upload(path, content) {
      storage.objects.set(path, { bytes: content, version: 1_000 + storage.objects.size });
      return Promise.resolve();
    },
    remove(paths) {
      for (const path of paths) storage.objects.delete(path);
      return Promise.resolve();
    },
    openRunDirectory() {
      return Promise.resolve(disk);
    },
    readLedger(_userId, missionId) {
      return Promise.resolve(ledgers.get(missionId) ?? []);
    },
    writeLedger(_userId, missionId, files) {
      ledgers.set(missionId, files);
      return Promise.resolve();
    },
  };

  return { gateway, ledgers };
}

describe("WorkspaceSync", () => {
  let storage: FakeStorage;
  let disk: FakeDisk;
  let sync: WorkspaceSync;
  let ledgers: Map<string, readonly FileState[]>;

  beforeEach(() => {
    storage = new FakeStorage();
    disk = new FakeDisk();
    const wired = gatewayOver(storage, disk);
    ledgers = wired.ledgers;
    sync = new WorkspaceSync(wired.gateway, new FixedClock(AT));
  });

  describe("materialize", () => {
    it("downloads the prefix onto disk and records what Storage held", async () => {
      storage.put(`${PREFIX}/MISSION.md`, "# Mission");
      storage.put(`${PREFIX}/lessons/0001-x.html`, "<h1>one</h1>");

      const { baseline } = await sync.materialize({ runId: "r1", userId: USER, workspaceKey: KEY });

      expect(disk.files.size).toBe(2);
      expect(text(disk.files.get("lessons/0001-x.html")!)).toBe("<h1>one</h1>");
      expect(baseline.map((f) => f.path).sort()).toEqual(["MISSION.md", "lessons/0001-x.html"]);
    });

    it("records the ETag and version from the listing, not from the download", async () => {
      // supabase-js's download returns a Blob and discards response headers, so
      // there is no other place these can come from. §7.4 used to describe it the
      // other way round.
      storage.put(`${PREFIX}/MISSION.md`, "# Mission");

      const { baseline } = await sync.materialize({ runId: "r1", userId: USER, workspaceKey: KEY });

      expect(baseline[0]).toMatchObject({
        storageEtag: storageEtag(bytes("# Mission")),
        storageVersion: "v1",
      });
    });

    it("skips retained conflict copies", async () => {
      // A conflict copy is not part of the workspace. Downloading it would put it
      // in the baseline and then index it — where its filename parses to a lesson
      // number that already exists and collides on unique (mission_id, seq).
      storage.put(`${PREFIX}/lessons/0001-x.html`, "<h1>mine</h1>");
      storage.put(
        `${PREFIX}/lessons/0001-x.html.conflict-2026-01-01T00-00-00-000Z`,
        "<h1>theirs</h1>",
      );

      const { baseline } = await sync.materialize({ runId: "r1", userId: USER, workspaceKey: KEY });

      expect(baseline.map((f) => f.path)).toEqual(["lessons/0001-x.html"]);
      expect([...disk.files.keys()]).toEqual(["lessons/0001-x.html"]);
    });

    it("handles an empty prefix, which is every first run", async () => {
      const { baseline } = await sync.materialize({ runId: "r1", userId: USER, workspaceKey: KEY });
      expect(baseline).toEqual([]);
    });
  });

  describe("syncBack", () => {
    async function materialized() {
      storage.put(`${PREFIX}/MISSION.md`, "# Mission");
      storage.put(`${PREFIX}/lessons/0001-x.html`, "<h1>one</h1>");
      return sync.materialize({ runId: "r1", userId: USER, workspaceKey: KEY });
    }

    it("writes nothing when the agent changed nothing", async () => {
      const { baseline } = await materialized();
      const before = new Map(storage.objects);

      const result = await sync.syncBack({
        userId: USER,
        missionId: MISSION,
        workspaceKey: KEY,
        dir: disk,
        baseline,
      });

      expect(result.changes.every((c) => c.kind === "unchanged")).toBe(true);
      expect(storage.objects).toEqual(before);
    });

    it("uploads an added file and a modified one", async () => {
      const { baseline } = await materialized();
      await disk.write("lessons/0002-y.html", bytes("<h1>two</h1>"));
      await disk.write("NOTES.md", bytes("scratch"));
      await disk.write("MISSION.md", bytes("# Mission\n\n## Topic\n\nRust"));

      const result = await sync.syncBack({
        userId: USER,
        missionId: MISSION,
        workspaceKey: KEY,
        dir: disk,
        baseline,
      });

      expect(text(storage.objects.get(`${PREFIX}/lessons/0002-y.html`)!.bytes)).toBe(
        "<h1>two</h1>",
      );
      expect(text(storage.objects.get(`${PREFIX}/MISSION.md`)!.bytes)).toContain("Rust");
      expect(result.conflicts).toEqual([]);
    });

    it("deletes a file the agent removed", async () => {
      const { baseline } = await materialized();
      disk.files.delete("lessons/0001-x.html");

      await sync.syncBack({
        userId: USER,
        missionId: MISSION,
        workspaceKey: KEY,
        dir: disk,
        baseline,
      });

      expect(storage.objects.has(`${PREFIX}/lessons/0001-x.html`)).toBe(false);
    });

    it("never uploads Mindforge's own scaffolding", async () => {
      // These are copied in so the skill's relative links resolve. Uploaded, they
      // would land in the user's Storage prefix, get workspace_files rows, and
      // then diff as deleted on the next run.
      const { baseline } = await materialized();
      await disk.write("BRIEFING.md", bytes("# Briefing"));
      await disk.write("SKILL.md", bytes("---\nname: teach\n---"));
      await disk.write("MISSION-FORMAT.md", bytes("# format"));

      const result = await sync.syncBack({
        userId: USER,
        missionId: MISSION,
        workspaceKey: KEY,
        dir: disk,
        baseline,
      });

      for (const name of ["BRIEFING.md", "SKILL.md", "MISSION-FORMAT.md"]) {
        expect(storage.objects.has(`${PREFIX}/${name}`)).toBe(false);
        expect(result.ledger.map((f) => f.path)).not.toContain(name);
      }
    });

    it("records the ledger from a listing taken after the upload", async () => {
      // The upload response carries no ETag, so the values the next run compares
      // against can only come from listing again.
      const { baseline } = await materialized();
      await disk.write("lessons/0002-y.html", bytes("<h1>two</h1>"));

      const result = await sync.syncBack({
        userId: USER,
        missionId: MISSION,
        workspaceKey: KEY,
        dir: disk,
        baseline,
      });

      const added = result.ledger.find((f) => f.path === "lessons/0002-y.html");
      expect(added?.storageEtag).toBe(storageEtag(bytes("<h1>two</h1>")));
      expect(ledgers.get(MISSION)).toEqual(result.ledger);
    });

    describe("when somebody else wrote while the agent had the workspace", () => {
      it("keeps both versions rather than overwriting", async () => {
        // Non-negotiable 6. Storage has no conditional write, so the window
        // between the check and the upload is real — retention is what makes it
        // survivable, not locking.
        const { baseline } = await materialized();
        await disk.write("lessons/0001-x.html", bytes("<h1>agent</h1>"));
        storage.put(`${PREFIX}/lessons/0001-x.html`, "<h1>somebody else</h1>");

        const result = await sync.syncBack({
          userId: USER,
          missionId: MISSION,
          workspaceKey: KEY,
          dir: disk,
          baseline,
        });

        expect(result.conflicts).toEqual([
          { path: "lessons/0001-x.html", reason: "changed_in_storage" },
        ]);
        expect(text(storage.objects.get(`${PREFIX}/lessons/0001-x.html`)!.bytes)).toBe(
          "<h1>somebody else</h1>",
        );
        expect(
          text(
            storage.objects.get(`${PREFIX}/lessons/0001-x.html.conflict-2026-08-08T12-00-00-000Z`)!
              .bytes,
          ),
        ).toBe("<h1>agent</h1>");
      });

      it("does not carry out a contested delete", async () => {
        // Removing a file somebody else has just written is the one operation
        // retention cannot undo.
        const { baseline } = await materialized();
        disk.files.delete("lessons/0001-x.html");
        storage.put(`${PREFIX}/lessons/0001-x.html`, "<h1>somebody else</h1>");

        const result = await sync.syncBack({
          userId: USER,
          missionId: MISSION,
          workspaceKey: KEY,
          dir: disk,
          baseline,
        });

        expect(result.conflicts).toHaveLength(1);
        expect(text(storage.objects.get(`${PREFIX}/lessons/0001-x.html`)!.bytes)).toBe(
          "<h1>somebody else</h1>",
        );
      });

      it("notices a byte-identical rewrite that the ETag cannot see", async () => {
        // The reason `version` is stored beside the ETag: md5 of the same content
        // is the same md5, and "somebody else is writing this workspace" is worth
        // knowing whether or not their write changed anything.
        const { baseline } = await materialized();
        await disk.write("MISSION.md", bytes("# Mission changed"));
        storage.put(`${PREFIX}/MISSION.md`, "# Mission");

        const result = await sync.syncBack({
          userId: USER,
          missionId: MISSION,
          workspaceKey: KEY,
          dir: disk,
          baseline,
        });

        expect(result.conflicts).toEqual([{ path: "MISSION.md", reason: "changed_in_storage" }]);
      });

      it("leaves the untouched files alone", async () => {
        // A conflict on one file must not stop the rest of the run's work landing.
        // The alternative — abandoning the whole sync — loses a lesson to protect
        // a mission file.
        const { baseline } = await materialized();
        await disk.write("MISSION.md", bytes("# Mission agent"));
        await disk.write("lessons/0002-y.html", bytes("<h1>two</h1>"));
        storage.put(`${PREFIX}/MISSION.md`, "# Mission somebody else");

        const result = await sync.syncBack({
          userId: USER,
          missionId: MISSION,
          workspaceKey: KEY,
          dir: disk,
          baseline,
        });

        expect(result.conflicts.map((c) => c.path)).toEqual(["MISSION.md"]);
        expect(text(storage.objects.get(`${PREFIX}/lessons/0002-y.html`)!.bytes)).toBe(
          "<h1>two</h1>",
        );
      });
    });
  });
});
