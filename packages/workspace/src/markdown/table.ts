/**
 * GitHub-flavoured pipe tables, and binding their columns by name.
 *
 * Shared by `RESOURCES.md` and `CURRICULUM.md`, which are the two formats the
 * agent writes as tables and rewrites wholesale on every run. That makes the
 * binding rule the important part rather than the splitting:
 *
 * **Bind cells by header name, never by position.** The moment an agent adds a
 * `Status` column or writes Trust before Type, positional binding starts filing
 * URLs as trust levels — and because both files are regenerated from scratch each
 * time, it does so on every row at once. Unknown headers are reported rather than
 * dropped; missing ones read as null.
 */

import { type ParseWarning, warn } from "../parse/result.js";

export interface Table {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Parse a pipe table out of a section body.
 *
 * Leading and trailing pipes are optional in the wild, and the delimiter row is
 * matched rather than assumed to be the second line — an agent that omits it
 * writes something that is not a table, and reading its header row as data is
 * worse than reading nothing.
 */
export function parseTable(body: string): Table | null {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") || line.includes("|"));

  if (lines.length < 2) return null;

  const headers = splitRow(lines[0]!);
  const isDelimiter = splitRow(lines[1]!).every((cell) => /^:?-{1,}:?$/u.test(cell));
  if (!isDelimiter) return null;

  const rows = lines
    .slice(2)
    .map(splitRow)
    .filter((row) => row.some((cell) => cell !== ""));

  return { headers, rows };
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Header text, normalised the way a heading is: collapsed, casefolded. */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/gu, " ");
}

export interface BoundTable<F extends string> {
  readonly rows: readonly (readonly string[])[];
  /** Cell for a bound field, or null when the table has no such column. */
  cell(row: readonly string[], field: F): string | null;
  /**
   * Whether the table has a column for this field at all.
   *
   * Distinct from `cell(...) === null`, which also covers a bound column whose
   * cell is empty. A missing column is a format change worth refusing the table
   * over; an empty cell is one row the agent left blank.
   */
  has(field: F): boolean;
  /** Header indexes nothing claimed, so a caller can retain them in `unmapped`. */
  readonly extras: readonly number[];
  readonly headers: readonly string[];
}

/**
 * Bind a table's headers to field names through an alias map.
 *
 * Built once and read per row, which is what makes an added or reordered column
 * harmless. A header matching no alias is not an error: it goes to `extras` so
 * the caller can keep the content, because "Mindforge has nowhere to put this" is
 * a fact about Mindforge and not about the file.
 */
export function bindColumns<F extends string>(
  table: Table,
  aliases: Readonly<Record<string, F>>,
  warnings: ParseWarning[],
  /**
   * Consulted when no alias matches exactly. For headers whose wording a model
   * varies more than its meaning — "Why it's here" arrives with three different
   * apostrophes and sometimes as just "Why".
   */
  fallback?: (normalizedHeader: string) => F | undefined,
): BoundTable<F> {
  const columnOf = new Map<F, number>();
  const extras: number[] = [];

  for (const [index, header] of table.headers.entries()) {
    const key = normalizeHeader(header);
    const field = aliases[key] ?? fallback?.(key);
    if (field === undefined) {
      extras.push(index);
      warnings.push(warn("section_unknown", { heading: header }));
      continue;
    }
    // First wins, like a duplicated heading: a table with two `Slug` columns is
    // one the agent got wrong, and picking the later one silently discards the
    // cells every row already filled in under the first.
    if (!columnOf.has(field)) columnOf.set(field, index);
  }

  return {
    rows: table.rows,
    headers: table.headers,
    extras,
    cell(row, field) {
      const index = columnOf.get(field);
      if (index === undefined) return null;
      const value = row[index];
      return value === undefined || value === "" ? null : value;
    },
    has: (field) => columnOf.has(field),
  };
}

/** `[Title](url)`, or bare text. */
export function parseLink(cell: string): { title: string; url: string | null } {
  const link = /^\s*\[(?<title>[^\]]*)\]\((?<url>[^)]*)\)\s*$/u.exec(cell);
  if (link?.groups) {
    return {
      title: link.groups["title"]!.trim(),
      url: link.groups["url"]!.trim() || null,
    };
  }
  return { title: cell.trim(), url: null };
}

/**
 * Cells that mean "nothing here", including the format docs' em dash.
 *
 * A markdown-table convention rather than a curriculum one: a hand-written table
 * writes `—` where a program would write an empty string, and every parser reading
 * one has to know that. It lived in `parse/curriculum.ts` while that file was the
 * only reader; it moved here when the module-table parser split out, because the
 * alternative was the two halves importing a constant from each other.
 *
 * Both scripts' dashes and both languages' words, because the agent writes these
 * files and writes them in the learner's content language (§5.2).
 */
const NONE_MARKERS: ReadonlySet<string> = new Set([
  "—",
  "–",
  "-",
  "--",
  "none",
  "n/a",
  "na",
  "nenhum",
  "nenhuma",
]);

export function isNoneMarker(cell: string): boolean {
  return NONE_MARKERS.has(cell.trim().toLowerCase());
}
