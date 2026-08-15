/**
 * `## Module: <slug>` → the lessons a track plans, before any of them is written
 * (NORTHSTAR M4, TECH-DESIGN §3.2b).
 *
 * Split out of `curriculum.ts`, which had grown to 792 lines holding two parsers
 * that share only a file. The seam is real: this half reads *lesson* rows and
 * resolves them against the tracks the other half has already produced, so it
 * depends on that output and nothing depends on it but the entry point.
 *
 * Three rules live here, and each is a thing the file format cannot say:
 *
 * 1. **A module section is found by what it names, not by where it sits.** Each
 *    heading is resolved against the tracks table — by slug first, then by name.
 *    Position would be the cheaper rule and it breaks the first time the agent
 *    reorders two sections or drops one, which is a whole module of lessons filed
 *    under the wrong subtopic with nothing to notice it.
 *
 * 2. **Difficulty and depth are the learner's, and unknown is not a middle.** A
 *    cell the parser cannot read becomes null and is warned about, never a 3 and
 *    never `working` — a default here is a claim about how hard something is for
 *    this person (non-negotiable 10).
 *
 * 3. **A lesson's dependencies are ordered by where their modules sit.** Which is
 *    why this runs after the tracks and takes their order as an argument rather
 *    than reading it back out of the document.
 */

import type { LessonDepth } from "@mindforge/core";

import { deslugify, slugify } from "../layout.js";
import type { Document, Section } from "../markdown/sections.js";
import { bindColumns, isNoneMarker, parseLink, parseTable } from "../markdown/table.js";
import { breakCycles, splitPrerequisites } from "./curriculum-edges.js";
import type { ParsedPlannedLesson, ParsedTrack } from "./curriculum.js";
import { warn, type ParseWarning } from "./result.js";

const MODULE_HEADING = "Module";

/**
 * Headings the tracks half already owns, so a `## Module:` scan cannot claim one.
 *
 * Duplicated from `curriculum.ts` rather than imported, because importing a *value*
 * from it would close a runtime cycle: that file imports `parseModules` from this
 * one. `curriculum.test.ts` covers both halves through the single entry point, so a
 * heading added to one list and not the other fails there.
 */
const RESERVED_HEADINGS = new Set(["subject", "tracks", "sources", "history"]);

type LessonField = "slug" | "title" | "intent" | "difficulty" | "depth" | "dependsOn";

const LESSON_COLUMNS: Readonly<Record<string, LessonField>> = {
  slug: "slug",
  id: "slug",
  key: "slug",
  "lesson slug": "slug",
  lesson: "title",
  title: "title",
  name: "title",
  intent: "intent",
  why: "intent",
  purpose: "intent",
  "for what": "intent",
  difficulty: "difficulty",
  level: "difficulty",
  depth: "depth",
  "depends on": "dependsOn",
  "depends-on": "dependsOn",
  depends: "dependsOn",
  after: "dependsOn",
  prerequisites: "dependsOn",
  prerequisite: "dependsOn",
  prereqs: "dependsOn",
  prereq: "dependsOn",
  requires: "dependsOn",
};

/**
 * The written forms of each depth, keyed by their letters alone.
 *
 * Keyed that way because `deep dive`, `deep-dive`, `deep_dive` and `DeepDive`
 * are one value written four ways, and the column is a closed set — an agent that
 * hyphenated it should not lose the field. Anything outside the set stays null:
 * inventing `working` for `intermediate` would be a claim about a lesson nobody
 * has read.
 */
const DEPTHS: Readonly<Record<string, LessonDepth>> = {
  overview: "overview",
  overviews: "overview",
  visaogeral: "overview",
  working: "working",
  workingknowledge: "working",
  pratico: "working",
  deepdive: "deep_dive",
  deep: "deep_dive",
  aprofundado: "deep_dive",
};

const DIFFICULTY_MIN = 1;
const DIFFICULTY_MAX = 5;

/* ── The module tables: lessons planned before they are written ───────────── */

interface ParsedModules {
  readonly lessons: readonly ParsedPlannedLesson[];
  /** Section keys read as a module, so the caller does not also call them unknown. */
  readonly consumed: ReadonlySet<string>;
}

/** A row, before its `Depends on` cell can be resolved against every other module. */
type LessonDraft = Omit<ParsedPlannedLesson, "dependsOn">;

const DEPENDS_ON_FIELD = "depends on";

export function parseModules(
  doc: Document,
  tracks: readonly ParsedTrack[],
  warnings: ParseWarning[],
  unmapped: Record<string, string>,
): ParsedModules {
  const consumed = new Set<string>();
  const sections = matchModuleSections(doc, tracks, warnings, unmapped, consumed);
  if (sections.size === 0) return { lessons: [], consumed };

  const drafts: LessonDraft[] = [];
  const rawDepends = new Map<string, string | null>();
  /** Lesson slug → its module. Also the file-wide uniqueness check on slugs. */
  const trackOf = new Map<string, string>();

  // Iterated in track order rather than section order: which module is "earlier"
  // is decided by the tracks table, and the sections may be written in any order.
  for (const track of tracks) {
    const section = sections.get(track.slug);
    if (section) {
      parseLessonRows(section, track.slug, { drafts, rawDepends, trackOf }, warnings, unmapped);
    }
  }

  const edges = resolveDependencies(drafts, rawDepends, trackOf, moduleOrder(tracks), warnings);

  return {
    lessons: drafts.map((draft) => ({ ...draft, dependsOn: edges.get(draft.slug) ?? [] })),
    consumed,
  };
}

/**
 * Sections that name a track → that track's module table.
 *
 * A heading that says `Module` and names nothing is consumed anyway. Leaving it
 * to the unknown-section path would retain the body just the same, but it would
 * report a section Mindforge has no table for — when what actually happened is
 * that a module of planned lessons named a track this curriculum does not have,
 * which is a renamed slug or an invented one and worth saying so.
 */
function matchModuleSections(
  doc: Document,
  tracks: readonly ParsedTrack[],
  warnings: ParseWarning[],
  unmapped: Record<string, string>,
  consumed: Set<string>,
): ReadonlyMap<string, Section> {
  const found = new Map<string, Section>();
  if (tracks.length === 0) return found;

  const slugs = new Set(tracks.map((track) => track.slug));
  const byName = new Map(tracks.map((track) => [slugify(track.name), track.slug] as const));

  for (const [key, section] of doc.sections) {
    if (RESERVED_HEADINGS.has(key)) continue;

    const { candidates, explicit } = readModuleHeading(section.heading);
    const track = candidates
      .map((candidate) => (slugs.has(candidate) ? candidate : byName.get(candidate)))
      .find((slug) => slug !== undefined);

    if (track === undefined) {
      if (!explicit) continue;
      consumed.add(key);
      unmapped[section.heading] = section.body;
      warnings.push(warn("value_unknown", { field: MODULE_HEADING, value: section.heading }));
      continue;
    }

    consumed.add(key);

    if (found.has(track)) {
      // First wins, like a duplicated heading. Two sections for one module is one
      // module split in two, and merging them would invent an ordering across the
      // seam that neither table states.
      warnings.push(warn("value_duplicated", { field: MODULE_HEADING, value: track }));
      unmapped[section.heading] = section.body;
      continue;
    }

    found.set(track, section);
  }

  return found;
}

/**
 * The slugs a module heading might be naming, best guess first.
 *
 * `## Module: iam-basics`, `## Module: IAM fundamentals`, `## iam-basics — IAM
 * fundamentals` and a bare `## IAM fundamentals` are all the same intent. The
 * whole heading is tried before any trimmed form, so a track genuinely called
 * "Module design" resolves to itself rather than to a track called "design".
 */
function readModuleHeading(heading: string): { candidates: readonly string[]; explicit: boolean } {
  const stripped = heading.replace(/^\s*(?:modules?|módulos?)\s*[:—–-]?\s*/iu, "");
  const candidates: string[] = [];

  for (const form of [heading, stripped, beforeDash(heading), beforeDash(stripped)]) {
    const slug = slugify(form);
    if (slug !== "" && !candidates.includes(slug)) candidates.push(slug);
  }

  return { candidates, explicit: /^\s*(?:modules?|módulos?)\b/iu.test(heading) };
}

/**
 * `iam-basics — IAM fundamentals` → `iam-basics`.
 *
 * Spaced dashes only. A slug's own hyphens are not separators, and splitting on
 * them would turn every heading into its first word.
 */
function beforeDash(heading: string): string {
  return heading.split(/\s+[—–-]\s+/u)[0]!;
}

interface ModuleAccumulator {
  readonly drafts: LessonDraft[];
  readonly rawDepends: Map<string, string | null>;
  readonly trackOf: Map<string, string>;
}

function parseLessonRows(
  section: Section,
  trackSlug: string,
  into: ModuleAccumulator,
  warnings: ParseWarning[],
  unmapped: Record<string, string>,
): void {
  const field = `${MODULE_HEADING}: ${trackSlug}`;

  const table = parseTable(section.body);
  if (!table) {
    // A module whose plan is prose is a module with no plan. Retained whole, so
    // the next run can read what the agent meant to say.
    warnings.push(warn("value_malformed", { field, reason: "not_a_table" }));
    unmapped[section.heading] = section.body;
    return;
  }

  const bound = bindColumns(table, LESSON_COLUMNS, warnings);
  if (!bound.has("slug") && !bound.has("title")) {
    warnings.push(warn("value_malformed", { field, reason: "no_identity_column" }));
    unmapped[section.heading] = section.body;
    return;
  }

  let position = 0;

  for (const row of bound.rows) {
    const title = bound.cell(row, "title");
    const label = title === null ? null : parseLink(title).title;
    const declared = bound.cell(row, "slug");
    const slug = slugify(declared ?? "") || slugify(label ?? "");

    if (slug === "") {
      warnings.push(warn("value_malformed", { field, reason: "no_slug" }));
      continue;
    }

    if (declared === null) {
      // Same trap as a derived track slug, one level down: the generated lesson
      // claims its plan entry by slug, so a slug that moves when the title is
      // reworded detaches a finished lesson from the row that counts it.
      warnings.push(warn("value_coerced", { field: "slug", from: label ?? "", to: slug }));
    }

    if (into.trackOf.has(slug)) {
      // Checked across the whole file, not per module: `(mission_id, slug)` is
      // what a written lesson claims its plan entry by, so two rows sharing a
      // slug are two modules fighting over one row.
      warnings.push(warn("value_duplicated", { field: "slug", value: slug }));
      continue;
    }

    position += 1;

    into.drafts.push({
      slug,
      // NOT NULL, and one of the two is always present by the guard above.
      title: label || deslugify(slug),
      intent: bound.cell(row, "intent"),
      difficulty: readDifficulty(bound.cell(row, "difficulty"), slug, warnings),
      depth: readDepth(bound.cell(row, "depth"), slug, warnings),
      trackSlug,
      position,
    });
    into.rawDepends.set(slug, bound.cell(row, "dependsOn"));
    into.trackOf.set(slug, trackSlug);

    for (const extra of bound.extras) {
      const value = row[extra];
      if (value) unmapped[`${field}/${slug}/${bound.headers[extra]}`] = value;
    }
  }
}

/**
 * `Difficulty` → 1–5, or null.
 *
 * Null rather than clamped, and null rather than a default. A 7 clamped to 5 is a
 * number nobody wrote presented as one somebody did, and a missing difficulty
 * defaulted to 3 puts a lesson in the middle of an ordering it was never placed
 * in. Both are the same failure as a 0% progress bar: a measurement claim about
 * something unmeasured (non-negotiable 10).
 */
function readDifficulty(
  raw: string | null,
  lesson: string,
  warnings: ParseWarning[],
): number | null {
  if (raw === null) return null;

  const value = raw.trim();
  if (isNoneMarker(value)) return null;

  const digits = /(\d+)/u.exec(value);
  const parsed = digits ? Number(digits[1]) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < DIFFICULTY_MIN || parsed > DIFFICULTY_MAX) {
    warnings.push(warn("value_malformed", { field: "difficulty", value, lesson }));
    return null;
  }

  return parsed;
}

/** `Deep dive`, `deep-dive`, `DEEP_DIVE` → `deep_dive`. Anything else → null. */
function readDepth(
  raw: string | null,
  lesson: string,
  warnings: ParseWarning[],
): LessonDepth | null {
  if (raw === null) return null;

  const value = raw.trim();
  if (isNoneMarker(value)) return null;

  const depth = DEPTHS[slugify(value).replace(/-/gu, "")];
  if (depth === undefined) {
    warnings.push(warn("value_unknown", { field: "depth", value, lesson }));
    return null;
  }

  return depth;
}

/**
 * Track slug → its place in the plan's order, prerequisites respected.
 *
 * Not `tracks.position`, which is a cell the agent typed and may repeat, skip or
 * contradict. A track sits after everything it requires — depth in the
 * prerequisite graph first, the table's own row order to break ties — which is
 * the only ordering the file states twice and agrees with itself on.
 */
function moduleOrder(tracks: readonly ParsedTrack[]): ReadonlyMap<string, number> {
  const prerequisites = new Map(tracks.map((track) => [track.slug, track.prerequisites] as const));
  const depths = new Map<string, number>();

  const visit = (slug: string): number => {
    const known = depths.get(slug);
    if (known !== undefined) return known;

    // Seeded before recursing so a cycle terminates. The parser has already
    // broken the ones this file describes; this is what keeps a future caller
    // from hanging on a graph it assembled some other way.
    depths.set(slug, 0);

    let depth = 0;
    for (const prereq of prerequisites.get(slug) ?? []) depth = Math.max(depth, visit(prereq) + 1);

    depths.set(slug, depth);
    return depth;
  };

  const ordered = tracks
    .map((track, index) => ({ slug: track.slug, depth: visit(track.slug), index }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index);

  return new Map(ordered.map((track, order) => [track.slug, order] as const));
}

/**
 * `Depends on` cells → lesson slugs, backwards only, cycle-free.
 *
 * Three ways an edge is refused, and each of them keeps a lesson reachable rather
 * than protecting the schema. An unknown target has no row to point `prereq_id`
 * at. A forward edge — into a module that comes later — locks a lesson behind
 * work the plan puts after it, so it would never unblock (FR-K2, FR-K7). And a
 * cycle makes every lesson in it permanently locked, which the UI would render as
 * a module that simply never starts.
 */
function resolveDependencies(
  drafts: readonly LessonDraft[],
  rawDepends: ReadonlyMap<string, string | null>,
  trackOf: ReadonlyMap<string, string>,
  order: ReadonlyMap<string, number>,
  warnings: ParseWarning[],
): ReadonlyMap<string, string[]> {
  const slugs = new Set(drafts.map((draft) => draft.slug));

  const byTitle = new Map<string, string>();
  for (const draft of drafts) {
    const key = slugify(draft.title);
    if (!byTitle.has(key)) byTitle.set(key, draft.slug);
  }

  const edges = new Map<string, string[]>();

  for (const draft of drafts) {
    const resolved: string[] = [];
    const own = order.get(draft.trackSlug) ?? 0;

    for (const entry of splitPrerequisites(rawDepends.get(draft.slug) ?? null)) {
      const candidate = slugify(parseLink(entry).title.replace(/^#/u, ""));
      const target = slugs.has(candidate) ? candidate : byTitle.get(candidate);

      if (target === undefined) {
        warnings.push(
          warn("value_unknown", { field: DEPENDS_ON_FIELD, value: entry, lesson: draft.slug }),
        );
        continue;
      }
      if (target === draft.slug) {
        warnings.push(warn("edge_cycle", { node: draft.slug, prereq: target }));
        continue;
      }
      if ((order.get(trackOf.get(target) ?? "") ?? 0) > own) {
        warnings.push(
          warn("value_malformed", {
            field: DEPENDS_ON_FIELD,
            reason: "forward_module_edge",
            value: entry,
            lesson: draft.slug,
          }),
        );
        continue;
      }
      if (!resolved.includes(target)) resolved.push(target);
    }

    edges.set(draft.slug, resolved);
  }

  breakCycles(edges, warnings);

  return edges;
}
