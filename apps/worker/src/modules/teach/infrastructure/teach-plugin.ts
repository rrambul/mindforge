import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTeachPlugin, type TeachPlugin } from "@mindforge/workspace";

/**
 * Materialising the `teach` plugin onto disk.
 *
 * The composition rules — and why a plugin rather than a file in the workspace —
 * live in `packages/workspace/src/skill/plugin.ts` and TECH-DESIGN.md §7.3. This
 * is only the filesystem half.
 *
 * One thing that has to be right here and nowhere else: **the SDK does not expand
 * `~`, and a plugin path that does not exist is skipped silently.** No throw, no
 * warning — the session simply runs with no skill and writes a plausible lesson
 * from parametric memory. So every path is resolved absolutely, and the caller
 * asserts against `system/init` rather than trusting that this worked.
 */

/** Filenames copied beside `SKILL.md` so its relative links resolve. */
const FORMAT_DOCS = [
  "MISSION-FORMAT.md",
  "RESOURCES-FORMAT.md",
  "LEARNING-RECORD-FORMAT.md",
] as const;

/** Repo root, from this file's location. `apps/worker/src/modules/teach/infrastructure` → up six. */
function repoRoot(): string {
  return fileURLToPath(new URL("../../../../../../", import.meta.url));
}

export interface WrittenTeachPlugin extends TeachPlugin {
  /** Absolute path to pass as `plugins: [{ type: "local", path }]`. */
  readonly path: string;
  /** Absolute paths of the format docs, which are also copied into the workspace root. */
  readonly formatDocs: Readonly<Record<string, string>>;
}

/**
 * Read `skills/` and write the composed plugin to `destination`.
 *
 * Called once per run rather than once per process: the run's temp directory is
 * deleted afterwards, and a plugin shared between concurrent runs would be a
 * shared mutable path for no gain — it is four small files.
 */
export async function writeTeachPlugin(destination: string): Promise<WrittenTeachPlugin> {
  const source = join(repoRoot(), "skills");

  const [skill, addendum, ...docs] = await Promise.all([
    readFile(join(source, "teach", "SKILL.md"), "utf8"),
    readFile(join(source, "UNATTENDED.md"), "utf8"),
    ...FORMAT_DOCS.map((name) => readFile(join(source, "teach", name), "utf8")),
  ]);

  const formatDocs = Object.fromEntries(FORMAT_DOCS.map((name, index) => [name, docs[index]!]));
  const plugin = buildTeachPlugin({ skill, addendum, formatDocs });

  await Promise.all(
    Object.entries(plugin.files).map(async ([relative, contents]) => {
      const target = join(destination, relative);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, "utf8");
    }),
  );

  return { ...plugin, path: destination, formatDocs };
}
