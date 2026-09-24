import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCurriculumPlugin, buildTeachPlugin, type TeachPlugin } from "@mindforge/workspace";

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

/** Filenames copied beside `teach/SKILL.md` so its relative links resolve. */
const FORMAT_DOCS = [
  "MISSION-FORMAT.md",
  "RESOURCES-FORMAT.md",
  "LEARNING-RECORD-FORMAT.md",
] as const;

/** The same, for `curriculum/SKILL.md`. */
const CURRICULUM_FORMAT_DOCS = ["CURRICULUM-FORMAT.md"] as const;

/**
 * Skills a lesson run loads beside `teach`, each a directory under `skills/` and the
 * files in it to copy. The licence travels with the copy because MIT's permission
 * is conditional on it.
 */
const TEACH_COMPANIONS = { humanizer: ["SKILL.md", "LICENSE"] } as const;

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
  return write(destination, {
    skillDir: "teach",
    // Order matters: UNATTENDED.md opens by referring to "everything above" as the
    // upstream skill. LESSON-SHAPE.md is not about being unattended — `/teach-me`
    // reads it too — so it is its own file rather than a section of the addendum.
    addendumFiles: ["UNATTENDED.md", "LESSON-SHAPE.md"],
    docs: FORMAT_DOCS,
    companions: TEACH_COMPANIONS,
    compose: buildTeachPlugin,
  });
}

/**
 * The `curriculum` plugin, written the same way.
 *
 * A separate directory and a separate call because a run loads exactly one of the
 * two. Structure and material are produced by different skills on purpose — a
 * teach run able to reach for `curriculum` would rewrite the plan it was supposed
 * to be working through, and a curriculum run able to reach for `teach` would
 * generate the whole module at the moment it knew least.
 */
export async function writeCurriculumPlugin(destination: string): Promise<WrittenTeachPlugin> {
  return write(destination, {
    skillDir: "curriculum",
    addendumFiles: ["CURRICULUM-UNATTENDED.md"],
    docs: CURRICULUM_FORMAT_DOCS,
    companions: {},
    compose: buildCurriculumPlugin,
  });
}

interface PluginSource {
  readonly skillDir: string;
  /** Appended after `SKILL.md` in this order, each separated by a blank line. */
  readonly addendumFiles: readonly string[];
  readonly docs: readonly string[];
  /** Directory under `skills/` → the files in it to copy. */
  readonly companions: Readonly<Record<string, readonly string[]>>;
  readonly compose: (sources: {
    skill: string;
    addendum: string;
    formatDocs: Record<string, string>;
    companions: Record<string, Record<string, string>>;
  }) => TeachPlugin;
}

async function write(destination: string, spec: PluginSource): Promise<WrittenTeachPlugin> {
  const source = join(repoRoot(), "skills");

  const [skill, addenda, docs, companionEntries] = await Promise.all([
    readFile(join(source, spec.skillDir, "SKILL.md"), "utf8"),
    Promise.all(spec.addendumFiles.map((name) => readFile(join(source, name), "utf8"))),
    Promise.all(spec.docs.map((name) => readFile(join(source, spec.skillDir, name), "utf8"))),
    Promise.all(
      Object.entries(spec.companions).map(async ([dir, names]) => {
        const contents = await Promise.all(
          names.map((name) => readFile(join(source, dir, name), "utf8")),
        );
        return [dir, Object.fromEntries(names.map((name, i) => [name, contents[i]!]))] as const;
      }),
    ),
  ]);
  const addendum = addenda.map((text) => text.trim()).join("\n\n") + "\n";

  const formatDocs = Object.fromEntries(spec.docs.map((name, index) => [name, docs[index]!]));
  const companions = Object.fromEntries(companionEntries);
  const plugin = spec.compose({ skill, addendum, formatDocs, companions });

  await Promise.all(
    Object.entries(plugin.files).map(async ([relative, contents]) => {
      const target = join(destination, relative);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, "utf8");
    }),
  );

  return { ...plugin, path: destination, formatDocs };
}
