import { sha256, storageEtag, type FileState } from "@mindforge/workspace";
import { beforeEach, describe, expect, it } from "vitest";

import { MEMORY_MOUNT, MemorySync } from "./memory-sync.js";
import type { RunDirectory, WorkspaceGateway } from "./workspace.port.js";

/**
 * The learner's memory, in and out of a run (§7.6).
 *
 * Two rules do all the work here, and both are about who owns the memory. It is
 * mounted from its **own** prefix rather than the mission's, because it spans
 * every mission. And the agent may write it but may not forget on the learner's
 * behalf — that a stated preference changed is itself the information.
 */

const USER = "user-1";
const PREFIX = `memory/${USER}`;

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

class FakeDisk implements RunDirectory {
  readonly root = "/tmp/fake";
  readonly files = new Map<string, Uint8Array>();

  walk() {
    // Mirrors the real one: `.memory` is excluded, which is what stops it being
    // uploaded into the mission's prefix.
    return Promise.resolve(
      [...this.files.entries()]
        .filter(([path]) => !path.startsWith(`${MEMORY_MOUNT}/`))
        .map(([path, content]) => ({ path, bytes: content })),
    );
  }
  walkUnder(prefix: string) {
    return Promise.resolve(
      [...this.files.entries()]
        .filter(([path]) => path.startsWith(`${prefix}/`))
        .map(([path, content]) => ({ path, bytes: content })),
    );
  }
  read(path: string) {
    const found = this.files.get(path);
    return found ? Promise.resolve(found) : Promise.reject(new Error(`no ${path}`));
  }
  write(path: string, content: Uint8Array) {
    this.files.set(path, content);
    return Promise.resolve();
  }
  dispose() {
    return Promise.resolve();
  }
}

let storage: Map<string, Uint8Array>;
let disk: FakeDisk;
let sync: MemorySync;

beforeEach(() => {
  storage = new Map();
  disk = new FakeDisk();

  const gateway = {
    list: (prefix: string) =>
      Promise.resolve(
        [...storage.entries()]
          .filter(([path]) => path.startsWith(`${prefix}/`))
          .map(([path, content]) => ({
            path: path.slice(prefix.length + 1),
            sizeBytes: content.byteLength,
            etag: storageEtag(content),
            version: "v1",
          })),
      ),
    download: (path: string) => Promise.resolve(storage.get(path) ?? bytes("")),
    upload: (path: string, content: Uint8Array) => {
      storage.set(path, content);
      return Promise.resolve();
    },
    remove: (paths: readonly string[]) => {
      for (const path of paths) storage.delete(path);
      return Promise.resolve();
    },
  } as unknown as WorkspaceGateway;

  sync = new MemorySync(gateway);
});

describe("materialize", () => {
  it("mounts the memory prefix inside the workspace", async () => {
    storage.set(`${PREFIX}/background.md`, bytes("# Engineer\n"));

    await sync.materialize(USER, disk);

    expect(text(disk.files.get(`${MEMORY_MOUNT}/background.md`)!)).toBe("# Engineer\n");
  });

  it("reads from the user's own prefix, not a mission's", async () => {
    // The whole point of §7.6: `NOTES.md` is per workspace and cannot tell a Rust
    // mission what a Portuguese one learned about how somebody likes to be taught.
    storage.set(`workspaces/${USER}/rust/NOTES.md`, bytes("mission scratch"));
    storage.set(`${PREFIX}/background.md`, bytes("# Engineer\n"));

    const { baseline } = await sync.materialize(USER, disk);

    expect(baseline.map((f) => f.path)).toEqual(["background.md"]);
  });

  it("treats an empty memory as a legal state", async () => {
    // Every account starts here. §7.6 is explicit that an onboarding
    // questionnaire is the wrong answer, so the agent gets an empty directory and
    // the addendum telling it what belongs there.
    const { baseline } = await sync.materialize(USER, disk);

    expect(baseline).toEqual([]);
  });
});

describe("syncBack", () => {
  async function materialized(files: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(files)) {
      storage.set(`${PREFIX}/${path}`, bytes(content));
    }
    return sync.materialize(USER, disk);
  }

  it("uploads a memory the agent wrote", async () => {
    const { baseline } = await materialized();
    await disk.write(`${MEMORY_MOUNT}/learning-patterns.md`, bytes("# Retains by building\n"));

    const result = await sync.syncBack({ userId: USER, dir: disk, baseline });

    expect(result.written).toEqual(["learning-patterns.md"]);
    expect(text(storage.get(`${PREFIX}/learning-patterns.md`)!)).toContain("Retains by building");
  });

  it("uploads a memory the agent revised", async () => {
    const { baseline } = await materialized({ "background.md": "# Engineer\n" });
    await disk.write(`${MEMORY_MOUNT}/background.md`, bytes("# Engineer, mostly backend\n"));

    const result = await sync.syncBack({ userId: USER, dir: disk, baseline });

    expect(result.written).toEqual(["background.md"]);
  });

  it("writes nothing when the agent left the memory alone", async () => {
    // The common case. An unconditional upload would move `updated_at` on every
    // run and make the review screen claim the agent had been revising things it
    // never touched.
    const { baseline } = await materialized({ "background.md": "# Engineer\n" });

    const result = await sync.syncBack({ userId: USER, dir: disk, baseline });

    expect(result.written).toEqual([]);
  });

  it("does not delete a memory the agent removed", async () => {
    // §7.6: supersede, never mutate. An agent that "tidied up" by deleting a
    // memory would erase the record of having believed something — and the
    // learner, not the run, is the one who gets to forget.
    const { baseline } = await materialized({ "background.md": "# Engineer\n" });
    disk.files.delete(`${MEMORY_MOUNT}/background.md`);

    const result = await sync.syncBack({ userId: USER, dir: disk, baseline });

    expect(result.deleted).toEqual(["background.md"]);
    expect(storage.has(`${PREFIX}/background.md`)).toBe(true);
  });

  it("never writes the mission's files into the memory prefix", async () => {
    // The mirror of `.memory` being on the workspace exclude list. Both
    // directions have to hold, or one prefix ends up with the other's contents.
    const { baseline } = await materialized();
    await disk.write("MISSION.md", bytes("# Mission"));
    await disk.write("lessons/0001-x.html", bytes("<h1>x</h1>"));

    await sync.syncBack({ userId: USER, dir: disk, baseline });

    expect([...storage.keys()]).toEqual([]);
  });

  it("ignores non-markdown files the agent left in the mount", async () => {
    const { baseline } = await materialized();
    await disk.write(`${MEMORY_MOUNT}/scratch.txt`, bytes("nope"));

    const result = await sync.syncBack({ userId: USER, dir: disk, baseline });

    expect(result.written).toEqual([]);
  });

  it("records a hash the next run can compare against", async () => {
    const { baseline } = await materialized({ "background.md": "# Engineer\n" });

    expect(baseline[0]).toMatchObject<Partial<FileState>>({
      contentHash: sha256(bytes("# Engineer\n")),
    });
  });
});
