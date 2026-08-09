import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import { Inject, Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isExcludedFromSync, type FileState, type StoredObject } from "@mindforge/workspace";

import type { PrismaClient } from "@mindforge/db";

import { ENV, type Env } from "../../../shared/env.js";
import { PRISMA } from "../../../shared/prisma.js";
import type { RunDirectory, WorkspaceGateway } from "../application/workspace.port.js";

/**
 * Supabase Storage, the filesystem, and the `workspace_files` ledger.
 *
 * Everything vendor-specific about §7.4 lives here, and three things in it are
 * not what the Storage client's shape suggests:
 *
 * 1. **The ETag comes from `list()`, never from `download()`.** supabase-js hands
 *    back a Blob and discards the response headers, so the metadata has to be
 *    collected in a separate pass. `WorkspaceSync` lists before downloading for
 *    exactly this reason.
 * 2. **`upload()` returns no ETag either**, so the ledger's values come from a
 *    second listing after the write.
 * 3. **`list()` is not recursive.** It returns one directory level, with
 *    subdirectories appearing as entries whose `id` is null. A workspace is three
 *    levels deep, so this walks.
 *
 * The service-role key bypasses RLS by design (§3.6). Every path this builds is
 * therefore scoped by `user_id` in code, which is the enforcement — the bucket
 * has no policies precisely because nothing but this class touches it.
 */

const BUCKET = "mindforge";

@Injectable()
export class SupabaseWorkspaceGateway implements WorkspaceGateway {
  private readonly storage: SupabaseClient["storage"];

  constructor(
    @Inject(ENV) env: Env,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {
    this.storage = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage;
  }

  async list(prefix: string): Promise<readonly StoredObject[]> {
    const found: StoredObject[] = [];
    // Breadth-first rather than recursion, so a deeply nested assets/ directory
    // cannot blow the stack on a workspace somebody hand-edited.
    const pending = [""];

    while (pending.length > 0) {
      const relativeDir = pending.pop()!;
      const target = relativeDir === "" ? prefix : `${prefix}/${relativeDir}`;

      const { data, error } = await this.storage.from(BUCKET).list(target, { limit: 1_000 });
      if (error) throw error;

      for (const entry of data ?? []) {
        const path = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;

        // A directory placeholder: no id, no metadata. Storage has no directories,
        // so this is the listing's way of reporting a shared path segment.
        if (entry.id === null) {
          pending.push(path);
          continue;
        }

        found.push({
          path,
          sizeBytes: entry.metadata?.["size"] ?? 0,
          etag: entry.metadata?.["eTag"] ?? null,
          version: null,
        });
      }
    }

    return found;
  }

  async download(path: string): Promise<Uint8Array> {
    const { data, error } = await this.storage.from(BUCKET).download(path);
    if (error) throw error;
    return new Uint8Array(await data.arrayBuffer());
  }

  async upload(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    // `upsert` because a run rewrites files it already owns, and the conflict
    // decision was made before we got here — refusing here would turn a normal
    // second lesson revision into an error.
    const { error } = await this.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) throw error;
  }

  async remove(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.storage.from(BUCKET).remove([...paths]);
    if (error) throw error;
  }

  async openRunDirectory(runId: string): Promise<RunDirectory> {
    const root = await mkdtemp(join(tmpdir(), `mindforge-${runId}-`));
    return new TempRunDirectory(root);
  }

  async readLedger(userId: string, missionId: string): Promise<readonly FileState[]> {
    const rows = await this.prisma.workspaceFile.findMany({
      where: { userId, missionId },
    });

    return rows.map((row) => ({
      path: row.path,
      contentHash: row.contentHash,
      sizeBytes: row.sizeBytes,
      storageEtag: row.storageEtag,
      storageVersion: row.storageVersion,
    }));
  }

  async writeLedger(userId: string, missionId: string, files: readonly FileState[]): Promise<void> {
    // Delete-then-insert over the mission, for the reason `daily_activity`
    // rebuilds a range rather than upserting a day: an upsert can only revise a
    // row that is still there, and a file the agent deleted has to make its row
    // disappear.
    await this.prisma.$transaction([
      this.prisma.workspaceFile.deleteMany({ where: { userId, missionId } }),
      this.prisma.workspaceFile.createMany({
        data: files.map((file) => ({
          userId,
          missionId,
          path: file.path,
          contentHash: file.contentHash,
          sizeBytes: file.sizeBytes,
          storageEtag: file.storageEtag ?? null,
          storageVersion: file.storageVersion ?? null,
        })),
      }),
    ]);
  }
}

class TempRunDirectory implements RunDirectory {
  constructor(readonly root: string) {}

  async walk(): Promise<readonly { readonly path: string; readonly bytes: Uint8Array }[]> {
    const files: { path: string; bytes: Uint8Array }[] = [];

    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        // Posix separators, because every path that leaves here becomes a Storage
        // key and a `workspace_files.path`.
        const path = relative(this.root, absolute).split(sep).join("/");

        // Excluded at the walk, not at the upload. A file skipped only on upload
        // still enters the diff, and then diffs as `deleted` the next time a run
        // writes it.
        if (isExcludedFromSync(path)) continue;

        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) files.push({ path, bytes: await readFile(absolute) });
      }
    };

    await visit(this.root);
    return files;
  }

  async walkUnder(
    prefix: string,
  ): Promise<readonly { readonly path: string; readonly bytes: Uint8Array }[]> {
    const files: { path: string; bytes: Uint8Array }[] = [];

    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const absolute = join(directory, entry.name);
        const path = relative(this.root, absolute).split(sep).join("/");

        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) files.push({ path, bytes: await readFile(absolute) });
      }
    };

    // Missing is empty, not an error: a run whose learner has no memory yet never
    // creates the directory, and that is the state every account starts in.
    await visit(join(this.root, prefix));
    return files;
  }

  read(path: string): Promise<Uint8Array> {
    return readFile(join(this.root, path));
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const target = join(this.root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async dispose(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}
