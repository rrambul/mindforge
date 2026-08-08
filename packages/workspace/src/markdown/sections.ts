/**
 * Splitting a `teach` document into headed sections.
 *
 * Shared by `MISSION.md` and the learning records, which have the same shape: a
 * single H1, an optional bare `Key: value` preamble, then a flat list of `##`
 * sections whose headings are the contract.
 *
 * Three decisions, each of which is a silent-corruption source if made the other
 * way:
 *
 * 1. **Sections are keyed by a normalised heading, never by position.** An agent
 *    that adds a section, reorders two, or writes `### Evidence` instead of
 *    `## Evidence` should shift nothing. Index-based binding survives exactly
 *    until the first time the model is creative.
 *
 * 2. **A template placeholder is empty.** The format docs are written as fenced
 *    examples with `<what the user is learning, in one line>` bodies, and an
 *    agent that writes the shell before filling it leaves them in place. Treating
 *    "non-empty text" as content stores the placeholder as the user's mission.
 *
 * 3. **A repeated heading keeps the first and warns.** Silently concatenating
 *    them would invent a section the file does not contain; silently taking the
 *    last would discard content with no trace.
 */

import { type ParseWarning, warn } from "../parse/result.js";

export interface Section {
  /** The heading exactly as written, for `unmapped` and for diagnostics. */
  readonly heading: string;
  /** Body with placeholders resolved to `""`. */
  readonly body: string;
}

export interface Document {
  /** First H1's text, or `null`. Note `MISSION.md`'s is the constant "Mission". */
  readonly h1: string | null;
  /** Bare `Key: value` lines between the H1 and the first `##`, keyed normalised. */
  readonly preamble: ReadonlyMap<string, string>;
  /** Normalised heading → section. */
  readonly sections: ReadonlyMap<string, Section>;
  readonly warnings: readonly ParseWarning[];
}

/**
 * Trim, collapse internal whitespace, drop a trailing colon, casefold.
 *
 * `## Key Insight`, `##  key insight`, and `## Key Insight:` are the same
 * section. Anything more aggressive (stripping punctuation, stemming) starts
 * merging headings that are genuinely different.
 */
export function normalizeHeading(heading: string): string {
  return heading.trim().replace(/\s+/gu, " ").replace(/:$/u, "").toLowerCase();
}

/** `<anything>` on its own is the format doc's placeholder syntax, not content. */
function isPlaceholder(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") && !trimmed.includes("\n");
}

interface RawHeading {
  readonly text: string;
  readonly level: number;
  /** Index of the line the heading occupies; body starts after it. */
  readonly line: number;
  /** Setext headings consume the underline too. */
  readonly consumed: number;
}

/**
 * ATX (`## Heading`) at any level, plus Setext (`Heading` over `===` or `---`).
 *
 * Setext is supported because it is legal Markdown a model may well emit, and a
 * missed heading is not a parse failure — it is a section silently absorbed into
 * the body of the one above it, which is worse.
 */
function findHeadings(lines: readonly string[]): RawHeading[] {
  const found: RawHeading[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    const atx = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (atx) {
      found.push({ text: atx[2]!.trim(), level: atx[1]!.length, line: i, consumed: 1 });
      continue;
    }

    // A Setext underline only counts under a non-blank line that is not itself a
    // heading. Without the emptiness check, a `---` thematic break turns the
    // paragraph above it into a heading and swallows the section boundary.
    const next = lines[i + 1];
    if (next !== undefined && line.trim() !== "" && !line.startsWith("#")) {
      if (/^=+\s*$/u.test(next)) {
        found.push({ text: line.trim(), level: 1, line: i, consumed: 2 });
        i += 1;
      } else if (/^-{3,}\s*$/u.test(next)) {
        found.push({ text: line.trim(), level: 2, line: i, consumed: 2 });
        i += 1;
      }
    }
  }

  return found;
}

export function parseDocument(source: string): Document {
  const lines = source.replace(/\r\n/gu, "\n").split("\n");
  const headings = findHeadings(lines);
  const warnings: ParseWarning[] = [];

  const firstH1 = headings.find((h) => h.level === 1);
  const h1 = firstH1?.text ?? null;

  // Everything between the H1 and the first sub-heading. Learning records put
  // `Date:` and `Lesson:` here, with no heading of their own.
  const preamble = new Map<string, string>();
  const preambleStart = firstH1 ? firstH1.line + firstH1.consumed : 0;
  const preambleEnd = headings.find((h) => h.level > 1)?.line ?? lines.length;
  for (const line of lines.slice(preambleStart, preambleEnd)) {
    const pair = /^\s*([A-Za-z][\w -]*?)\s*:\s*(.*)$/u.exec(line);
    if (pair) preamble.set(normalizeHeading(pair[1]!), pair[2]!.trim());
  }

  const sections = new Map<string, Section>();
  const subHeadings = headings.filter((h) => h.level > 1);

  for (const [index, heading] of subHeadings.entries()) {
    const key = normalizeHeading(heading.text);
    const bodyStart = heading.line + heading.consumed;
    const bodyEnd = subHeadings[index + 1]?.line ?? lines.length;
    const raw = lines.slice(bodyStart, bodyEnd).join("\n").trim();

    if (sections.has(key)) {
      // First wins. Concatenating would invent a section the file does not
      // contain; taking the last discards content with no trace.
      warnings.push(warn("heading_duplicated", { heading: heading.text }));
      continue;
    }

    sections.set(key, {
      heading: heading.text,
      body: isPlaceholder(raw) ? "" : raw,
    });

    if (isPlaceholder(raw)) warnings.push(warn("section_placeholder", { heading: heading.text }));
  }

  return { h1, preamble, sections, warnings };
}

/**
 * Read a section's body, warning when it is absent or empty.
 *
 * Both collapse to `null` for the caller — a section that is missing and a
 * section that is present but unfilled are the same fact about the data — but
 * they warn differently, because they are different facts about the file and
 * only one of them suggests the format changed.
 */
export function readSection(
  doc: Document,
  heading: string,
  warnings: ParseWarning[],
  { required = false }: { required?: boolean } = {},
): string | null {
  const section = doc.sections.get(normalizeHeading(heading));

  if (!section) {
    if (required) warnings.push(warn("section_missing", { heading }));
    return null;
  }
  if (section.body === "") {
    if (required) warnings.push(warn("section_empty", { heading }));
    return null;
  }
  return section.body;
}
