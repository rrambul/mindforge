/**
 * `CURRICULUM.md` → the plan: tracks, their order and their prerequisites, and
 * each track's planned lessons (NORTHSTAR M4, TECH-DESIGN §3.2, §3.2b, §7.4).
 *
 * A mission is a main topic; a track is a subtopic; a track's lessons are its
 * module. This file is what the `curriculum` skill writes, and it is an index of
 * **intent** — the lessons it plans have no content and may never be written, and
 * the ones that do get written declare their own track in a `<meta>` tag. Where
 * this file and the lessons disagree, the lessons are right.
 *
 * Four rules, each learned from what the file cannot say:
 *
 * 1. **The slug is the identity and the name is not.** Lessons point at slugs, so
 *    a row with no slug gets one derived from its name — losing the track
 *    entirely would be worse (§7.4's degradation rule) — but the derivation is
 *    warned about, because a later rename would move a derived slug and orphan
 *    the module it had accumulated.
 *
 * 2. **`Order` is a plan and prerequisites are the structure.** Both are parsed;
 *    only one of them is allowed to decide anything downstream. `tracks.position`
 *    is what the curriculum recommended, and §9.4's ZPD score over real evidence
 *    is what actually sequences teaching.
 *
 * 3. **Cycles are broken here, not in Postgres.** `track_edges` can refuse a
 *    self-edge and nothing more — a DAG is not expressible as a constraint. The
 *    edge that closes a cycle is dropped with a warning rather than the file being
 *    rejected, because a curriculum with one bad prerequisite is still 14 good
 *    subtopics.
 *
 * 4. **`## Sources` is deliberately not indexed.** The skill records sources in
 *    `RESOURCES.md` as it finds them, and that file is what owns the library
 *    (FR-T8). Indexing this section too would write the same resources through a
 *    second path with no type and no trust column — which is the RESOURCES.md
 *    doubling problem with the safeguards removed. It is retained in `unmapped`.
 *
 * 5. **A module section is found by what it names, not by where it sits.** Each
 *    track's planned lessons live under `## Module: <track slug>`, and the
 *    heading is resolved against the tracks table — by slug first, then by name.
 *    Position would be the cheaper rule and it breaks the first time the agent
 *    reorders two sections or drops one, which is a whole module of lessons filed
 *    under the wrong subtopic with nothing to notice it.
 */

import type { LessonDepth } from "@mindforge/core";

import { deslugify, slugify } from "../layout.js";
import { parseDocument, readSection, type Document, type Section } from "../markdown/sections.js";
import { bindColumns, parseLink, parseTable } from "../markdown/table.js";
import { warn, type Parsed, type ParseWarning } from "./result.js";

const SUBJECT_HEADING = "Subject";
const TRACKS_HEADING = "Tracks";
const SOURCES_HEADING = "Sources";
const HISTORY_HEADING = "History";
const MODULE_HEADING = "Module";

const KNOWN_HEADINGS = new Set(
  [SUBJECT_HEADING, TRACKS_HEADING, SOURCES_HEADING, HISTORY_HEADING].map((h) => h.toLowerCase()),
);

type TrackField = "position" | "slug" | "name" | "outcome" | "prerequisites";

const TRACK_COLUMNS: Readonly<Record<string, TrackField>> = {
  order: "position",
  "#": "position",
  position: "position",
  slug: "slug",
  id: "slug",
  key: "slug",
  track: "name",
  name: "name",
  subtopic: "name",
  topic: "name",
  outcome: "outcome",
  goal: "outcome",
  "you can": "outcome",
  prerequisites: "prerequisites",
  prerequisite: "prerequisites",
  prereqs: "prerequisites",
  prereq: "prerequisites",
  requires: "prerequisites",
  "depends on": "prerequisites",
};

/** Cells that mean "no prerequisites", including the format doc's em dash. */
const NONE_MARKERS = new Set(["—", "–", "-", "--", "none", "n/a", "na", "nenhum", "nenhuma"]);

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
 * How far down a lesson goes.
 *
 * Re-exported from `packages/core` rather than declared here: it is the same
 * closed set the depth badge renders and the lesson graph reads, and two
 * declarations of one enum drift the moment a fourth value is added.
 */
export type { LessonDepth };

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

export interface ParsedTrack {
  /** Stable identity. What a lesson's `<meta name="mindforge:track">` names. */
  readonly slug: string;
  readonly name: string;
  /** One line, observable. Null when the row left it blank. */
  readonly outcome: string | null;
  /** The curriculum's recommended order. A plan — see rule 2 above. */
  readonly position: number;
  /** Slugs, resolved against this same file. Unresolvable ones are dropped. */
  readonly prerequisites: readonly string[];
}

/**
 * One row of a `## Module:` table — a lesson that is planned and not written.
 *
 * It has no file, no sequence number and no content: those arrive when `teach`
 * generates it and the generated file claims this row by slug. Everything the
 * agent is unsure of is nullable, because a lesson missing its difficulty is
 * still a lesson the module has to count.
 */
export interface ParsedPlannedLesson {
  /** Stable identity, unique across the whole curriculum, not just the module. */
  readonly slug: string;
  readonly title: string;
  /** One line: what the lesson is for. Null when the row left it blank. */
  readonly intent: string | null;
  /** 1–5, relative to this learner. Null when unreadable or out of range. */
  readonly difficulty: number | null;
  readonly depth: LessonDepth | null;
  /** The track whose `## Module:` section this row came from. */
  readonly trackSlug: string;
  /** Row order within its module. A plan — `dependsOn` is the structure. */
  readonly position: number;
  /** Lesson slugs, resolved across the whole file. Forward edges are dropped. */
  readonly dependsOn: readonly string[];
}

export interface ParsedCurriculum {
  /** `## Subject`, one line. Null when unfilled — never defaulted to the topic. */
  readonly subject: string | null;
  readonly tracks: readonly ParsedTrack[];
  /**
   * Every planned lesson in the file, in track order then row order.
   *
   * Flat rather than nested under its track because that is the shape the index
   * writes: one upsert per lesson, keyed on `(mission_id, slug)`. A track with no
   * `## Module:` section contributes nothing here, and that is the honest state —
   * a module with no plan has no denominator, and the UI says so rather than
   * rendering a zero.
   */
  readonly lessons: readonly ParsedPlannedLesson[];
}

export function parseCurriculum(source: string): Parsed<ParsedCurriculum> {
  const doc = parseDocument(source);
  const warnings: ParseWarning[] = [...doc.warnings];
  const unmapped: Record<string, string> = {};

  const subject = readSection(doc, SUBJECT_HEADING, warnings)?.split("\n")[0]?.trim() || null;

  const tracks = parseTracks(
    readSection(doc, TRACKS_HEADING, warnings, { required: true }),
    warnings,
    unmapped,
  );

  // After the tracks, because a module section is resolved by naming one of them
  // and a lesson's dependencies are ordered by where their modules sit.
  const { lessons, consumed } = parseModules(doc, tracks, warnings, unmapped);

  // Retained rather than indexed. `## Sources` belongs to RESOURCES.md (rule 4),
  // and `## History` has no table: `mission_revisions` earns its ledger from
  // `applyEdit` diffing real changes, and re-parsing a section that only grows
  // would inflate any equivalent here on every single run.
  for (const heading of [SOURCES_HEADING, HISTORY_HEADING]) {
    const body = readSection(doc, heading, warnings);
    if (body !== null) {
      unmapped[heading] = body;
      warnings.push(warn("section_unknown", { heading }));
    }
  }

  for (const [key, section] of doc.sections) {
    if (KNOWN_HEADINGS.has(key) || consumed.has(key)) continue;
    unmapped[section.heading] = section.body;
    warnings.push(warn("section_unknown", { heading: section.heading }));
  }

  return { parsed: { subject, tracks, lessons }, warnings, unmapped };
}

function parseTracks(
  body: string | null,
  warnings: ParseWarning[],
  unmapped: Record<string, string>,
): readonly ParsedTrack[] {
  if (body === null) return [];

  const table = parseTable(body);
  if (!table) {
    warnings.push(warn("value_malformed", { field: TRACKS_HEADING, reason: "not_a_table" }));
    return [];
  }

  const bound = bindColumns(table, TRACK_COLUMNS, warnings);

  // A table with neither is not a track list. Every other column is optional:
  // order falls back to row position, outcome and prerequisites to nothing.
  if (!bound.has("slug") && !bound.has("name")) {
    warnings.push(warn("value_malformed", { field: TRACKS_HEADING, reason: "no_identity_column" }));
    return [];
  }

  const bySlug = new Map<string, ParsedTrack>();
  /** Raw prerequisite cells, resolved once every slug in the table is known. */
  const rawPrereqs = new Map<string, string | null>();

  for (const [index, row] of bound.rows.entries()) {
    const name = bound.cell(row, "name");
    const declared = bound.cell(row, "slug");

    // `[Fundamentals](#fundamentals)` — an agent that linked its own table of
    // contents should not lose the row to the brackets.
    const label = name === null ? null : parseLink(name).title;
    const slug = slugify(declared ?? "") || slugify(label ?? "");

    if (slug === "") {
      warnings.push(warn("value_malformed", { field: TRACKS_HEADING, reason: "no_slug" }));
      continue;
    }

    if (declared === null) {
      // Recoverable but load-bearing: a derived slug moves if the track is ever
      // renamed, and a moved slug orphans the module its lessons point at.
      warnings.push(warn("value_coerced", { field: "slug", from: label ?? "", to: slug }));
    }

    if (bySlug.has(slug)) {
      // First wins, like a duplicated heading. `(mission_id, slug)` is unique, so
      // the alternative is a run that fails on a file it could mostly read.
      warnings.push(warn("value_duplicated", { field: "slug", value: slug }));
      continue;
    }

    bySlug.set(slug, {
      slug,
      // NOT NULL, and one of the two is always present by the guard above.
      name: label || deslugify(slug),
      outcome: bound.cell(row, "outcome"),
      position: readPosition(bound.cell(row, "position"), index, warnings),
      prerequisites: [],
    });
    rawPrereqs.set(slug, bound.cell(row, "prerequisites"));

    for (const extra of bound.extras) {
      const value = row[extra];
      if (value) unmapped[`${TRACKS_HEADING}/${slug}/${bound.headers[extra]}`] = value;
    }
  }

  return resolvePrerequisites(bySlug, rawPrereqs, warnings);
}

/**
 * `position` is NOT NULL, so an unreadable `Order` cell falls back to where the
 * row sits.
 *
 * Row order is the honest fallback rather than `0` or `null`-turned-zero: the
 * agent wrote the table top to bottom and fundamentals go first, so the sequence
 * it typed *is* the recommendation even when the numbers are missing.
 */
function readPosition(raw: string | null, index: number, warnings: ParseWarning[]): number {
  if (raw === null) return index + 1;

  const digits = /(-?\d+)/u.exec(raw);
  if (!digits) {
    warnings.push(warn("value_coerced", { field: "position", from: raw, to: index + 1 }));
    return index + 1;
  }
  return Number(digits[1]);
}

/**
 * Resolve prerequisite cells to slugs, then break any cycle they describe.
 *
 * Two passes because a track may name a prerequisite that appears below it in the
 * table, which is legal and common — the order column is a reading
 * recommendation, not a topological sort.
 */
function resolvePrerequisites(
  bySlug: ReadonlyMap<string, ParsedTrack>,
  rawPrereqs: ReadonlyMap<string, string | null>,
  warnings: ParseWarning[],
): readonly ParsedTrack[] {
  const byName = new Map<string, string>();
  for (const track of bySlug.values()) byName.set(slugify(track.name), track.slug);

  const edges = new Map<string, string[]>();

  for (const [slug, raw] of rawPrereqs) {
    const resolved: string[] = [];

    for (const entry of splitPrerequisites(raw)) {
      const candidate = slugify(parseLink(entry).title.replace(/^#/u, ""));
      const target = bySlug.has(candidate) ? candidate : byName.get(candidate);

      if (target === undefined) {
        // Dropped rather than kept: `track_edges.prereq_id` is a foreign key, and
        // there is no row to point it at. Named in the warning so the gap is
        // visible on the run result.
        warnings.push(warn("value_unknown", { field: "prerequisites", value: entry }));
        continue;
      }
      if (target === slug) {
        // The one case the CHECK constraint would also catch — refused here so a
        // run does not fail on a typo the file can survive.
        warnings.push(warn("edge_cycle", { node: slug, prereq: target }));
        continue;
      }
      if (!resolved.includes(target)) resolved.push(target);
    }

    edges.set(slug, resolved);
  }

  breakCycles(edges, warnings);

  return [...bySlug.values()].map((track) => ({
    ...track,
    prerequisites: edges.get(track.slug) ?? [],
  }));
}

/** `a, b; c` and the bulleted variants an agent writes in a table cell. */
function splitPrerequisites(raw: string | null): readonly string[] {
  if (raw === null) return [];
  if (NONE_MARKERS.has(raw.trim().toLowerCase())) return [];

  return raw
    .split(/[,;/]|\s+and\s+/u)
    .map((part) => part.replace(/^[-*+\s]+/u, "").trim())
    .filter((part) => part !== "" && !NONE_MARKERS.has(part.toLowerCase()));
}

/**
 * Drop the edges that close a cycle, in place. Used for both graphs the file
 * describes: prerequisites between tracks, and between planned lessons.
 *
 * Depth-first, keeping the first path found and refusing the back-edge — so the
 * curriculum's own reading order decides which edge survives, which is the only
 * non-arbitrary tie-break available. Neither `track_edges` nor `lesson_edges` can
 * express this, and their `not_self` checks catch only the one-hop case, so
 * nothing downstream would notice a two-hop cycle until a lesson turned out to be
 * its own prerequisite and never unblocked.
 */
function breakCycles(edges: Map<string, string[]>, warnings: ParseWarning[]): void {
  const state = new Map<string, "visiting" | "done">();

  const visit = (slug: string): void => {
    state.set(slug, "visiting");

    const prereqs = edges.get(slug) ?? [];
    const kept: string[] = [];

    for (const prereq of prereqs) {
      if (state.get(prereq) === "visiting") {
        warnings.push(warn("edge_cycle", { node: slug, prereq }));
        continue;
      }
      if (state.get(prereq) === undefined) visit(prereq);
      kept.push(prereq);
    }

    edges.set(slug, kept);
    state.set(slug, "done");
  };

  for (const slug of edges.keys()) {
    if (state.get(slug) === undefined) visit(slug);
  }
}

/* ── The module tables: lessons planned before they are written ───────────── */

interface ParsedModules {
  readonly lessons: readonly ParsedPlannedLesson[];
  /** Section keys read as a module, so the caller does not also call them unknown. */
  readonly consumed: ReadonlySet<string>;
}

/** A row, before its `Depends on` cell can be resolved against every other module. */
type LessonDraft = Omit<ParsedPlannedLesson, "dependsOn">;

const DEPENDS_ON_FIELD = "depends on";

function parseModules(
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
    if (KNOWN_HEADINGS.has(key)) continue;

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
  if (NONE_MARKERS.has(value.toLowerCase())) return null;

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
  if (NONE_MARKERS.has(value.toLowerCase())) return null;

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
