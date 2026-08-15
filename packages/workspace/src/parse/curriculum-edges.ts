/**
 * The two things both halves of `CURRICULUM.md` do with a "depends on" cell.
 *
 * The tracks table calls them prerequisites and the module tables call them
 * dependencies, but the parsing is identical and so is the rule they enforce: a
 * cycle is broken here, not in Postgres. `track_edges` and `lesson_edges` can each
 * refuse a self-edge and nothing more — a DAG is not expressible as a constraint —
 * so the edge that closes a cycle is dropped with a warning rather than the file
 * being rejected. A curriculum with one bad prerequisite is still fourteen good
 * subtopics.
 *
 * Extracted when the module parser split out of `curriculum.ts`: both halves need
 * these, and the alternative was two files importing runtime values from each
 * other.
 */

import { isNoneMarker } from "../markdown/table.js";
import { warn, type ParseWarning } from "./result.js";

/** `a, b; c` and the bulleted variants an agent writes in a table cell. */
export function splitPrerequisites(raw: string | null): readonly string[] {
  if (raw === null) return [];
  if (isNoneMarker(raw)) return [];

  return raw
    .split(/[,;/]|\s+and\s+/u)
    .map((part) => part.replace(/^[-*+\s]+/u, "").trim())
    .filter((part) => part !== "" && !isNoneMarker(part));
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
export function breakCycles(edges: Map<string, string[]>, warnings: ParseWarning[]): void {
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
