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
import { parseDocument, readSection } from "../markdown/sections.js";
import { bindColumns, parseLink, parseTable } from "../markdown/table.js";
import { breakCycles, splitPrerequisites } from "./curriculum-edges.js";
import { parseModules } from "./curriculum-modules.js";
import { warn, type Parsed, type ParseWarning } from "./result.js";

const SUBJECT_HEADING = "Subject";
const TRACKS_HEADING = "Tracks";
const SOURCES_HEADING = "Sources";
const HISTORY_HEADING = "History";

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

/**
 * How far down a lesson goes.
 *
 * Re-exported from `packages/core` rather than declared here: it is the same
 * closed set the depth badge renders and the lesson graph reads, and two
 * declarations of one enum drift the moment a fourth value is added.
 *
 * Re-exported from *this* file rather than from `curriculum-modules.ts`, which is
 * where it is actually used, because the package barrel has always taken it from
 * here and moving it would be a breaking change to `@mindforge/workspace` in
 * exchange for nothing.
 */
export type { LessonDepth };

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
