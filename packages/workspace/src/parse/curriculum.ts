/**
 * `CURRICULUM.md` → the subtopic level: tracks, their order and their
 * prerequisites (NORTHSTAR M4, TECH-DESIGN §3.2, §7.4).
 *
 * A mission is a main topic; a track is a subtopic; a track's lessons are its
 * module. This file is what the `curriculum` skill writes, and it is an index of
 * **intent** — the lessons that fill a module are generated one at a time, later,
 * and each declares its own track in a `<meta>` tag. Where this file and the
 * lessons disagree, the lessons are right.
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
 */

import { deslugify, slugify } from "../layout.js";
import { parseDocument, readSection } from "../markdown/sections.js";
import { bindColumns, parseLink, parseTable } from "../markdown/table.js";
import { type Parsed, type ParseWarning, warn } from "./result.js";

const SUBJECT_HEADING = "Subject";
const TRACKS_HEADING = "Tracks";
const SOURCES_HEADING = "Sources";
const HISTORY_HEADING = "History";

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

export interface ParsedCurriculum {
  /** `## Subject`, one line. Null when unfilled — never defaulted to the topic. */
  readonly subject: string | null;
  readonly tracks: readonly ParsedTrack[];
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

  const known = new Set(
    [SUBJECT_HEADING, TRACKS_HEADING, SOURCES_HEADING, HISTORY_HEADING].map((h) => h.toLowerCase()),
  );
  for (const [key, section] of doc.sections) {
    if (known.has(key)) continue;
    unmapped[section.heading] = section.body;
    warnings.push(warn("section_unknown", { heading: section.heading }));
  }

  return { parsed: { subject, tracks }, warnings, unmapped };
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
        warnings.push(warn("edge_cycle", { track: slug, prereq: target }));
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
 * Drop the edges that close a cycle, in place.
 *
 * Depth-first, keeping the first path found and refusing the back-edge — so the
 * curriculum's own reading order decides which edge survives, which is the only
 * non-arbitrary tie-break available. `track_edges` cannot express this and
 * `tracks_not_self` catches only the one-hop case, so nothing downstream would
 * notice a two-hop cycle until a topological sort hung on it.
 */
function breakCycles(edges: Map<string, string[]>, warnings: ParseWarning[]): void {
  const state = new Map<string, "visiting" | "done">();

  const visit = (slug: string): void => {
    state.set(slug, "visiting");

    const prereqs = edges.get(slug) ?? [];
    const kept: string[] = [];

    for (const prereq of prereqs) {
      if (state.get(prereq) === "visiting") {
        warnings.push(warn("edge_cycle", { track: slug, prereq }));
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
