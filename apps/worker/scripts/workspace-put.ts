/**
 * Put local files into a mission's teach workspace, and index them.
 *
 * ```sh
 * pnpm --filter @mindforge/worker put:workspace -- --mission=<uuid> --from=<dir>
 * ```
 *
 * **What this is for.** The agent is not the only thing allowed to write a
 * workspace — non-negotiable 5 says the files are canonical and that a human with
 * a terminal must be able to work on them without Mindforge. Until
 * `mindforge pull`/`push` exists (§7.2, "a small CLI, v2"), there is no way to get
 * a hand-written `CURRICULUM.md` or lesson into a mission at all. This is the
 * `push` half, and nothing more: it uploads bytes and runs the same reindexer a
 * real run's sync-back runs.
 *
 * **It runs no agent and costs nothing.** That is the point. A curriculum written
 * here — by a person, or by Claude in a terminal following `skills/curriculum` —
 * lands exactly as one an unattended run would have produced, because it goes
 * through the same parser into the same tables.
 *
 * **It is not a substitute for the button.** The app's own flow (FR-K1) dispatches
 * a real run and is what the product does; this is the escape hatch for authoring
 * by hand, and for putting content behind the reader without paying for a run
 * every time. If you want to know whether the *product* works, press the button.
 *
 * Storage first, then the index — the same order the sync uses, so a row never
 * points at a path that was never written.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";

import { ReindexWorkspace } from "@mindforge/api/teach";
import { contentTypeFor } from "@mindforge/core";
import { createPrismaClient } from "@mindforge/db";
import { isExcludedFromSync, workspacePrefix } from "@mindforge/workspace";
import { Test } from "@nestjs/testing";

import { WorkerModule } from "../src/app.module.js";

const BUCKET = "mindforge";

interface Options {
  readonly missionId: string;
  readonly from: string;
}

function parseOptions(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([\w-]+)=(.*)$/u.exec(arg);
    if (match) flags.set(match[1]!, match[2]!);
  }

  const missionId = flags.get("mission");
  const from = flags.get("from");
  if (!missionId || !from) {
    throw new Error("Usage: put:workspace -- --mission=<uuid> --from=<directory>");
  }
  return { missionId, from };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Source .env.local first.`);
  return value;
}

/** Every file under `root`, as workspace-relative paths with forward slashes. */
async function walk(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const found: string[] = [];

  for (const entry of entries) {
    const path = prefix === "" ? entry.name : `${prefix}${sep}${entry.name}`;
    if (entry.isDirectory()) found.push(...(await walk(root, path)));
    else found.push(path.split(sep).join("/"));
  }

  return found;
}

async function upload(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `${supabaseUrl.replace(/\/$/u, "")}/storage/v1/object/${BUCKET}/${encoded}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "content-type": contentTypeFor(path),
        // Upsert: revising a curriculum is the normal case, not an error.
        "x-upsert": "true",
      },
      body: bytes,
    },
  );

  if (!response.ok) {
    throw new Error(`Storage refused ${path}: ${response.status} ${await response.text()}`);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const prisma = createPrismaClient(requireEnv("DIRECT_URL"));

  const [mission] = await prisma.$queryRawUnsafe<
    { user_id: string; workspace_key: string | null; timezone: string }[]
  >(
    `select m.user_id, m.workspace_key, p.timezone
       from missions m join profiles p on p.id = m.user_id
      where m.id = $1::uuid`,
    options.missionId,
  );

  if (!mission) throw new Error(`No mission ${options.missionId}`);

  // A mission that has never been taught has no prefix. Derived the same way the
  // API derives it, rather than invented here, so a later real run finds the same
  // directory instead of starting a second history beside it.
  const workspaceKey = mission.workspace_key;
  if (workspaceKey === null) {
    throw new Error(
      `Mission ${options.missionId} has no workspace_key yet. ` +
        `The API assigns it when a run is first queued — press the button once, or set it by hand.`,
    );
  }

  const relativePaths = (await walk(options.from)).filter((path) => !isExcludedFromSync(path));
  if (relativePaths.length === 0) throw new Error(`No files under ${options.from}`);

  const files = new Map<string, Uint8Array>();
  for (const path of relativePaths) {
    files.set(path, new Uint8Array(await readFile(join(options.from, path))));
  }

  const prefix = workspacePrefix(mission.user_id, workspaceKey);
  for (const [path, bytes] of files) {
    await upload(supabaseUrl, serviceRoleKey, `${prefix}/${path}`, bytes);
    process.stdout.write(`  uploaded ${path}\n`);
  }

  // `compile()` rather than `init()`, for the reason `api-module-boot.test.ts`
  // gives: `NightlyScheduler` ticks on bootstrap, and a rollup is not what this
  // script was asked to do.
  const context = await Test.createTestingModule({ imports: [WorkerModule] }).compile();

  try {
    const result = await context.get(ReindexWorkspace, { strict: false }).execute({
      userId: mission.user_id,
      missionId: options.missionId,
      files,
      // Nothing is deleted from here. This script adds to a workspace; a file
      // that should go is a deletion the owner makes deliberately, and treating
      // "not in my staging directory" as "delete it" would let one hand-written
      // curriculum wipe every lesson a real run had produced.
      deleted: [],
      timezone: mission.timezone,
    });

    process.stdout.write(
      `\nindexed: ${JSON.stringify({
        tracks: result.tracks,
        plannedLessons: result.plannedLessons,
        lessons: result.lessons,
        referenceDocs: result.referenceDocs,
        records: result.records,
      })}\n`,
    );

    // Warnings are the parser's way of saying "stored, partially indexed" (§7.4).
    // Printed rather than swallowed: a curriculum with a bad column still lands,
    // and the line it lost is worth knowing about now rather than on screen.
    for (const warning of result.warnings) {
      process.stdout.write(`warning: ${warning.code} ${JSON.stringify(warning.args ?? {})}\n`);
    }
  } finally {
    await context.close();
    await prisma.$disconnect();
  }
}

await main();
