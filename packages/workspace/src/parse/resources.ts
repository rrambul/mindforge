/**
 * `RESOURCES.md` → the resource library (FR-T8, FR-R1).
 *
 * `RESOURCES.md` and the Resource library are the same data seen from two sides,
 * which makes this the parser with the most ways to quietly corrupt something the
 * user owns. Four rules, all of them learned from what the file does *not* say:
 *
 * 1. **Bind table cells by header name, not by position.** The moment an agent
 *    adds a `Status` column or writes Trust before Type, positional binding
 *    starts filing URLs as trust levels. Unknown headers become `unmapped`;
 *    missing ones become null.
 *
 * 2. **`type` is NOT NULL and the file's vocabulary is smaller than the
 *    column's.** The format doc lists four types, the database accepts seven.
 *    An unrecognised type is coerced rather than nulled, and the original is kept
 *    in `unmapped` so nothing is lost.
 *
 * 3. **`RESOURCES.md` has no status, progress, or abandon reason.** The database
 *    defaults status to `inbox`, so a naive write of a parsed resource resets a
 *    book the user marked `finished`. This parser therefore returns only the four
 *    fields the file actually represents, and the shape of `ParsedResource` is
 *    what stops a caller writing the others.
 *
 * 4. **`rejected_reason` is not `abandon_reason`.** The rejected list is the
 *    agent's judgement about a resource nobody started; `abandon_reason` is the
 *    user's own guilt-free quit (FR-R5), and it is prime friction data. Writing
 *    one into the other invents an abandonment that never happened.
 */

import { parseDocument, readSection } from "../markdown/sections.js";
import { bindColumns, parseLink, parseTable } from "../markdown/table.js";
import { type Parsed, type ParseWarning, warn } from "./result.js";

/** `resources.type`'s CHECK constraint. The format doc names only four of these. */
const RESOURCE_TYPES = ["book", "podcast", "article", "video", "course", "docs", "paper"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * Where an unrecognised type lands.
 *
 * `article` rather than null because the column is NOT NULL, and rather than
 * `docs` because it is the least load-bearing of the seven: nothing in the
 * product treats an article specially, whereas `book` implies pagination and
 * `course` implies structure.
 */
const TYPE_FALLBACK: ResourceType = "article";

/** Common things a model writes that mean one of the seven. */
const TYPE_ALIASES: Readonly<Record<string, ResourceType>> = {
  ebook: "book",
  textbook: "book",
  audiobook: "podcast",
  episode: "podcast",
  talk: "video",
  lecture: "video",
  youtube: "video",
  documentation: "docs",
  reference: "docs",
  spec: "docs",
  blog: "article",
  post: "article",
  "blog post": "article",
  essay: "article",
  "research paper": "paper",
  study: "paper",
  tutorial: "course",
  workshop: "course",
};

/** The doc shows `high / medium`; the column also permits `low`. */
const TRUST_LEVELS = ["high", "medium", "low"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

const PRIMARY_HEADING = "Primary Sources";
const COMMUNITIES_HEADING = "Communities";
const REJECTED_HEADING = "Explored But Rejected";

/** Header name → field, normalised. Several spellings map to the same field. */
const COLUMN_ALIASES: Readonly<Record<string, keyof ParsedResource>> = {
  resource: "title",
  title: "title",
  name: "title",
  source: "title",
  type: "type",
  kind: "type",
  format: "type",
  trust: "trust",
  "trust level": "trust",
  quality: "trust",
};

export interface ParsedResource {
  readonly title: string;
  readonly url: string | null;
  readonly type: ResourceType;
  readonly trust: TrustLevel | null;
  /** The "Why it's here" cell. Not a Mindforge column yet; carried for the caller. */
  readonly note: string | null;
}

export interface ParsedRejection {
  readonly title: string;
  readonly url: string | null;
  /** Maps to `resources.rejected_reason`. Never to `abandon_reason`. */
  readonly reason: string | null;
}

export interface ParsedResources {
  readonly primary: readonly ParsedResource[];
  readonly rejected: readonly ParsedRejection[];
}

function coerceType(raw: string | null, warnings: ParseWarning[]): ResourceType {
  if (raw === null || raw.trim() === "") {
    warnings.push(warn("value_coerced", { field: "type", from: "", to: TYPE_FALLBACK }));
    return TYPE_FALLBACK;
  }

  // The format doc writes the vocabulary as "book / video / course / docs", and
  // an agent copying that shape sometimes leaves the slashes in.
  const candidate = raw.split("/")[0]!.trim().toLowerCase();

  if ((RESOURCE_TYPES as readonly string[]).includes(candidate)) return candidate as ResourceType;

  const alias = TYPE_ALIASES[candidate];
  if (alias) return alias;

  warnings.push(warn("value_coerced", { field: "type", from: candidate, to: TYPE_FALLBACK }));
  return TYPE_FALLBACK;
}

function coerceTrust(raw: string | null, warnings: ParseWarning[]): TrustLevel | null {
  if (raw === null || raw.trim() === "") return null;

  const candidate = raw.split("/")[0]!.trim().toLowerCase();
  if ((TRUST_LEVELS as readonly string[]).includes(candidate)) return candidate as TrustLevel;

  // Null rather than a guess. Trust is the field the teaching is grounded in —
  // §7.3a caps a landing page at `medium` for the same reason — and inventing a
  // level from an unparseable cell is the one wrong answer here.
  warnings.push(warn("value_unknown", { field: "trust", value: candidate }));
  return null;
}

export function parseResources(source: string): Parsed<ParsedResources> {
  const doc = parseDocument(source);
  const warnings: ParseWarning[] = [...doc.warnings];
  const unmapped: Record<string, string> = {};

  const primary = parsePrimary(
    readSection(doc, PRIMARY_HEADING, warnings, { required: true }),
    warnings,
    unmapped,
  );
  const rejected = parseRejected(readSection(doc, REJECTED_HEADING, warnings), warnings);

  // `## Communities` is one of the skill's three pillars — knowledge, skills,
  // wisdom — and there is no communities table until M6 at the earliest. Retained
  // rather than dropped or forced into `resources`: none of the seven types fits
  // "forum / subreddit / local group", and filing a subreddit as an article would
  // put it in the reading queue.
  const communities = readSection(doc, COMMUNITIES_HEADING, warnings);
  if (communities !== null) {
    unmapped[COMMUNITIES_HEADING] = communities;
    warnings.push(warn("section_unknown", { heading: COMMUNITIES_HEADING }));
  }

  const known = new Set(
    [PRIMARY_HEADING, COMMUNITIES_HEADING, REJECTED_HEADING].map((h) => h.toLowerCase()),
  );
  for (const [key, section] of doc.sections) {
    if (known.has(key)) continue;
    unmapped[section.heading] = section.body;
    warnings.push(warn("section_unknown", { heading: section.heading }));
  }

  return { parsed: { primary, rejected }, warnings, unmapped };
}

function parsePrimary(
  body: string | null,
  warnings: ParseWarning[],
  unmapped: Record<string, string>,
): ParsedResource[] {
  if (body === null) return [];

  const table = parseTable(body);
  if (!table) {
    warnings.push(warn("value_malformed", { field: PRIMARY_HEADING, reason: "not_a_table" }));
    return [];
  }

  // "Why it's here", and the several apostrophes a model might use for it.
  const bound = bindColumns<keyof ParsedResource | "note">(
    table,
    COLUMN_ALIASES,
    warnings,
    (key) => (key.startsWith("why") ? "note" : undefined),
  );

  if (!bound.has("title")) {
    warnings.push(warn("value_malformed", { field: PRIMARY_HEADING, reason: "no_title_column" }));
    return [];
  }

  const resources: ParsedResource[] = [];

  for (const row of bound.rows) {
    const { title, url } = parseLink(bound.cell(row, "title") ?? "");
    if (title === "") continue;

    resources.push({
      title,
      url,
      type: coerceType(bound.cell(row, "type"), warnings),
      trust: coerceTrust(bound.cell(row, "trust"), warnings),
      note: bound.cell(row, "note"),
    });

    for (const index of bound.extras) {
      const value = row[index];
      if (value) unmapped[`${PRIMARY_HEADING}/${title}/${bound.headers[index]}`] = value;
    }
  }

  return resources;
}

/**
 * `- [Title](url) — <why it was rejected>`
 *
 * The separator is U+2014 EM DASH in the format doc, and agents write `-`, `--`,
 * `–`, or `:` instead. Splitting on the first dash anywhere in the line breaks
 * every title that contains one — "Rust By Example - Chapter 3" would lose its
 * chapter — so the split happens strictly **after the closing `)` of the link**,
 * and a bullet with no link falls back to the first separator surrounded by
 * spaces.
 */
function parseRejected(body: string | null, warnings: ParseWarning[]): ParsedRejection[] {
  if (body === null) return [];

  const rejections: ParsedRejection[] = [];

  for (const line of body.split("\n")) {
    const bullet = /^\s*[-*+]\s+(.*)$/u.exec(line);
    if (!bullet) continue;

    const text = bullet[1]!.trim();
    if (text === "") continue;

    const linked = /^\[(?<title>[^\]]*)\]\((?<url>[^)]*)\)\s*(?<rest>.*)$/u.exec(text);

    if (linked?.groups) {
      rejections.push({
        title: linked.groups["title"]!.trim(),
        url: linked.groups["url"]!.trim() || null,
        reason: stripSeparator(linked.groups["rest"]!),
      });
      continue;
    }

    const split = /^(?<title>.*?)\s+(?:—|–|--|-|:)\s+(?<reason>.*)$/u.exec(text);
    if (split?.groups) {
      rejections.push({
        title: split.groups["title"]!.trim(),
        url: null,
        reason: split.groups["reason"]!.trim() || null,
      });
      continue;
    }

    // A bullet with a title and no reason is still a rejection worth keeping —
    // the list's stated job is to stop the same weak resource being re-evaluated
    // next session, and it does that with or without the why.
    rejections.push({ title: text, url: null, reason: null });
    warnings.push(warn("value_malformed", { field: REJECTED_HEADING, reason: "no_reason" }));
  }

  return rejections;
}

function stripSeparator(rest: string): string | null {
  const trimmed = rest
    .trim()
    .replace(/^(?:—|–|--|-|:)\s*/u, "")
    .trim();
  return trimmed === "" ? null : trimmed;
}
