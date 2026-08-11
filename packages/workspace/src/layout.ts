/**
 * The workspace's own shape: where files live, which of them are ours, and how a
 * filename decomposes.
 *
 * The layout is byte-identical to a local teaching workspace on purpose (§7.2),
 * which is what makes `mindforge pull <mission>` a future afternoon rather than a
 * protocol. Nothing here should ever gain a Mindforge-only directory.
 */

export const WORKSPACE_ROOT = "workspaces";
export const MEMORY_ROOT = "memory";

export const LESSONS_DIR = "lessons";
export const REFERENCE_DIR = "reference";
export const RECORDS_DIR = "learning-records";
export const ASSETS_DIR = "assets";

export const MISSION_FILE = "MISSION.md";
export const CURRICULUM_FILE = "CURRICULUM.md";
export const RESOURCES_FILE = "RESOURCES.md";
export const NOTES_FILE = "NOTES.md";
export const BRIEFING_FILE = "BRIEFING.md";

/**
 * Files the run writes into the workspace that must never be uploaded back.
 *
 * Applied **at the walk, not at the upload**. A file excluded only from upload
 * still gets hashed, still lands in the diff, and diffs as `deleted` on the next
 * run that writes it again — so the exclusion has to happen before anything sees
 * the file at all.
 *
 * `BRIEFING.md` is regenerated every run. The other five are the skill and its
 * format docs, copied in so the skill's relative links resolve; uploading them
 * would put Mindforge's own scaffolding inside the user's Storage prefix and give
 * it `workspace_files` rows.
 *
 * `CURRICULUM.md` is **not** here, and the distinction is the whole point:
 * `CURRICULUM-FORMAT.md` is scaffolding and the curriculum itself is the
 * learner's, canonical in Storage like `MISSION.md`.
 *
 * `.claude-config` is `.claude`'s twin and was missing until a real run put it in
 * somebody's Storage prefix. `teach-run.ts` points `CLAUDE_CONFIG_DIR` at
 * `<run>/.claude-config` — inside the tree that gets synced — so the run's own
 * settings, its policy limits and a full session transcript were uploaded as the
 * learner's files and given `workspace_files` rows. The prefix match is on a
 * whole segment, so `.claude` never covered it.
 */
export const SYNC_EXCLUDE: readonly string[] = [
  BRIEFING_FILE,
  "SKILL.md",
  "MISSION-FORMAT.md",
  "CURRICULUM-FORMAT.md",
  "RESOURCES-FORMAT.md",
  "LEARNING-RECORD-FORMAT.md",
  ".memory",
  ".claude",
  ".claude-config",
];

/** Conflict copies (§7.4). Retained in Storage, never indexed. */
export const CONFLICT_SUFFIX = ".conflict-";

/** Storage prefix for one mission's workspace. */
export function workspacePrefix(userId: string, workspaceKey: string): string {
  return `${WORKSPACE_ROOT}/${userId}/${workspaceKey}`;
}

/** Storage prefix for a user's cross-mission learner memory (§7.6). */
export function memoryPrefix(userId: string): string {
  return `${MEMORY_ROOT}/${userId}`;
}

/**
 * True when a relative path is Mindforge's scaffolding rather than the learner's
 * workspace.
 *
 * Matches a directory prefix as well as an exact name, so `.memory/background.md`
 * is excluded by the `.memory` entry.
 */
export function isExcludedFromSync(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/gu, "/").replace(/^\.\//u, "");
  return SYNC_EXCLUDE.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
}

/** True for a `<path>.conflict-<timestamp>` copy. */
export function isConflictCopy(relativePath: string): boolean {
  return relativePath.includes(CONFLICT_SUFFIX);
}

export interface NumberedFile {
  /** From the filename. Null when it carries no `NNNN` prefix. */
  readonly seq: number | null;
  /** URL-safe, derived. **Never** use this to rebuild a path — see below. */
  readonly slug: string;
  /** The filename as it exists, which is the only thing a Storage path may be built from. */
  readonly filename: string;
}

/**
 * Decompose `0007-closures-and-capture.html`.
 *
 * **The slug is derived and lossy, and the filename is not.** A workspace can
 * legitimately contain `0003-café-com-leite.html` — the agent writes lessons in
 * the learner's content language (§5.2, FR-L3), and Portuguese is a first-class
 * option here. Normalising that for a URL is right; reconstructing the Storage
 * path from the normalised form points at a file that does not exist. So
 * `storage_path` is always built from `filename`.
 */
export function parseNumberedFilename(filename: string): NumberedFile {
  const base = filename.replace(/\.[^./]+$/u, "");
  const numbered = /^(\d{1,6})[-_]+(.*)$/u.exec(base);

  const seq = numbered ? Number(numbered[1]) : null;
  const rest = numbered ? numbered[2]! : base;

  return { seq, slug: slugify(rest) || slugify(base) || "untitled", filename };
}

/**
 * A URL-safe slug: decompose accents, drop what is left, collapse separators.
 *
 * `café com leite` → `cafe-com-leite`. Deliberately not transliterating beyond
 * NFD stripping — a real transliterator is a dependency and a set of language
 * assumptions, and the slug is a convenience, not an identifier.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/** `0007-closures-and-capture` → `Closures And Capture`, for a missing title. */
export function deslugify(slug: string): string {
  const words = slug.split(/[-_]+/u).filter(Boolean);
  if (words.length === 0) return "Untitled";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
