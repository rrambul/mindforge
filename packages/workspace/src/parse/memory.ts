/**
 * `memory/<user_id>/<slug>.md` → a learner memory (§7.6).
 *
 * **This format is Mindforge's own**, unlike everything else in this package.
 * The `teach` skill has no concept of cross-mission memory — its only preference
 * store is per-workspace `NOTES.md`, which cannot tell a Rust mission what a
 * Portuguese one learned about how somebody likes to be taught. So the shape is
 * defined here, and `skills/UNATTENDED.md` is where the agent is told about it.
 *
 * It deliberately mirrors a learning record rather than inventing something new:
 * an H1, an optional preamble line, then the body. The agent already writes that
 * shape four times a session, and a format it recognises is a format it fills in
 * correctly.
 *
 *     # Retains by building, not by reading
 *
 *     Kind: learning_pattern
 *     Supersedes: prefers-reading
 *
 *     Three sessions where a worked example landed and the prose before it did
 *     not. Lessons should lead with something to run.
 *
 * The H1 **is** the summary, which is what §7.6 means by "one fact per file, with
 * a one-line summary at the top" — that line is what gets loaded for relevance
 * selection once the memory outgrows what is worth injecting whole.
 */

import { slugify } from "../layout.js";
import { parseDocument } from "../markdown/sections.js";
import { type Parsed, type ParseWarning, warn } from "./result.js";

/** `learner_memories.kind`'s CHECK constraint. */
const KINDS = ["background", "teaching_preference", "learning_pattern", "constraint"] as const;
export type MemoryKind = (typeof KINDS)[number];

/**
 * Where an unrecognised or absent kind lands.
 *
 * `background` because it is the least consequential of the four: a fact filed
 * as background is shown to the agent as context, where one wrongly filed as a
 * `constraint` would have it refusing to plan a lesson longer than an assumed
 * limit.
 */
const KIND_FALLBACK: MemoryKind = "background";

/** What §7.6's layout implies: a file named for its kind is one. */
const FILENAME_KINDS: Readonly<Record<string, MemoryKind>> = {
  background: "background",
  "teaching-preferences": "teaching_preference",
  "teaching-preference": "teaching_preference",
  "learning-patterns": "learning_pattern",
  "learning-pattern": "learning_pattern",
  // What a real run actually named it. §7.6's layout says
  // `teaching-preferences.md`; the agent wrote `learning-preferences.md`, which
  // is the same thing said the other way round.
  "learning-preferences": "teaching_preference",
  constraints: "constraint",
  constraint: "constraint",
};

export interface ParsedMemory {
  readonly slug: string;
  /** The H1. Never empty — the filename is the fallback, because the column is NOT NULL. */
  readonly summary: string;
  readonly kind: MemoryKind;
  /** Everything below the preamble. May be empty; a summary alone is a legal memory. */
  readonly body: string;
  /** The slug this replaces, if the file says so. Null is the overwhelmingly common case. */
  readonly supersedes: string | null;
}

export function parseLearnerMemory(filename: string, source: string): Parsed<ParsedMemory> {
  const warnings: ParseWarning[] = [];
  const base = filename.replace(/\.[^./]+$/u, "");
  const slug = slugify(base) || "untitled";

  const doc = parseDocument(source);
  warnings.push(...doc.warnings);

  const summary = readSummary(doc.h1, base, warnings);
  const kind = readKind(doc.preamble.get("kind") ?? null, base, warnings);
  const supersedes = doc.preamble.get("supersedes")?.trim();

  return {
    parsed: {
      slug,
      summary,
      kind,
      // Everything after the preamble. `parseDocument` gives sections only when
      // there are sub-headings, and a memory usually has none — so the body is
      // taken from the source directly, minus the H1 and the key: value lines.
      body: bodyOf(source),
      supersedes: supersedes ? slugify(supersedes) : null,
    },
    warnings,
    unmapped: {},
  };
}

function readSummary(h1: string | null, base: string, warnings: ParseWarning[]): string {
  if (h1 !== null && h1.trim() !== "") return h1.trim();

  // NOT NULL, and the relevance-selection story depends on it being a sentence
  // rather than a filename — so this warns loudly rather than quietly making one.
  warnings.push(warn("title_missing", { source: "filename" }));
  return base.replace(/[-_]+/gu, " ").trim() || "Untitled";
}

function readKind(declared: string | null, base: string, warnings: ParseWarning[]): MemoryKind {
  const candidate = declared
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");
  if (candidate && (KINDS as readonly string[]).includes(candidate)) return candidate as MemoryKind;

  // §7.6's layout names four files after their kinds, so a file that did not
  // declare one may still have said it in its name.
  const fromFilename = FILENAME_KINDS[base.toLowerCase()];
  if (fromFilename) return fromFilename;

  if (candidate) warnings.push(warn("value_unknown", { field: "kind", value: candidate }));
  else warnings.push(warn("value_coerced", { field: "kind", to: KIND_FALLBACK }));
  return KIND_FALLBACK;
}

/**
 * The keys the preamble may carry. **Only these.**
 *
 * Matching any `Word: value` line was content loss, found by running this against
 * a real agent's memory rather than a fixture: it opened with
 * `Observed: 2026-08-09 (mission: Postgres RLS). Self-reported in MISSION.md…`,
 * a sentence that happens to start with a capitalised word and a colon. Half of
 * it was eaten and the body began mid-clause, silently.
 *
 * A closed list cannot do that. An unrecognised `Foo: bar` line is prose until
 * somebody adds it here, which is the right default for a format whose author is
 * a model.
 */
const PREAMBLE_KEYS = /^\s*(kind|supersedes)\s*:\s/iu;

/** Everything that is neither the H1 nor a recognised preamble line. */
function bodyOf(source: string): string {
  const lines = source.replace(/\r\n/gu, "\n").split("\n");
  const kept: string[] = [];
  let inPreamble = true;

  for (const line of lines) {
    if (/^#\s/u.test(line)) continue;
    if (inPreamble) {
      if (line.trim() === "") continue;
      if (PREAMBLE_KEYS.test(line)) continue;
      inPreamble = false;
    }
    kept.push(line);
  }

  return kept.join("\n").trim();
}
