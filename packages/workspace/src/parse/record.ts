/**
 * `learning-records/NNNN-slug.md` → a learning record (FR-T6).
 *
 * Six of the seven target columns are a one-to-one map from a heading. The
 * seventh is the interesting one: **`supersedes_id` has no heading in the format
 * at all.** LEARNING-RECORD-FORMAT.md describes supersession as prose — "write a
 * new record that supersedes it and link back to the old one" — so a parser that
 * looks for `## Supersedes` finds nothing, forever, and concludes that no insight
 * has ever been corrected. Since records are append-only, a superseded record
 * that is not marked as such keeps feeding the ZPD recommender an insight the
 * learner has since been taught out of.
 *
 * So it is inferred from an inline link, best-effort, and zero matches is normal
 * and silent. The one thing it must not do is guess: a wrong `supersedes` link
 * retires a record that was still true.
 */

import { parseDocument, readSection } from "../markdown/sections.js";
import { type Parsed, type ParseWarning, warn } from "./result.js";

const HEADINGS = {
  whatLearned: "What Was Learned",
  evidence: "Evidence",
  keyInsight: "Key Insight",
  struggles: "Struggles",
  next: "Next",
} as const;

/** `# NNNN. <Title>` — the number is decoration here; the filename is authoritative. */
const H1_TITLE = /^\s*(?:(\d{1,6})\s*[.)]\s*)?(.*)$/u;

/** A link to another record, anywhere in the document. */
const RECORD_LINK = /(\d{3,6})-[^\s)]*\.md/gu;

/** A line that claims this record replaces another. */
const SUPERSEDE_PHRASE = /\b(supersed|replac|correct|revis|overrid)/iu;

export interface ParsedRecord {
  readonly title: string | null;
  /** `YYYY-MM-DD` as written. The caller resolves it in the user's zone, never server-local. */
  readonly date: string | null;
  /** The `Lesson:` preamble line, as written — a relative path or a link. */
  readonly lessonRef: string | null;
  /** NOT NULL in the database. `""` here means "the section was missing", never "throw". */
  readonly whatLearned: string;
  readonly evidence: string | null;
  readonly keyInsight: string | null;
  readonly struggles: string | null;
  readonly next: string | null;
  /** The `NNNN` of the record this one replaces, inferred from an inline link. */
  readonly supersedesSeq: number | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function parseLearningRecord(source: string): Parsed<ParsedRecord> {
  const doc = parseDocument(source);
  const warnings: ParseWarning[] = [...doc.warnings];
  const unmapped: Record<string, string> = {};

  const title = parseTitle(doc.h1, warnings);
  const date = parseDate(doc.preamble.get("date") ?? null, warnings);

  // `what_learned` is NOT NULL. Storing "" plus a warning is the whole
  // degradation rule in one line: throwing here fails the run and loses the
  // record's other four sections, which are often the useful ones.
  const whatLearned = readSection(doc, HEADINGS.whatLearned, warnings, { required: true }) ?? "";

  const known = new Set(Object.values(HEADINGS).map((h) => h.toLowerCase()));
  for (const [key, section] of doc.sections) {
    if (known.has(key)) continue;
    unmapped[section.heading] = section.body;
    warnings.push(warn("section_unknown", { heading: section.heading }));
  }

  return {
    parsed: {
      title,
      date,
      lessonRef: doc.preamble.get("lesson") || null,
      whatLearned,
      evidence: readSection(doc, HEADINGS.evidence, warnings),
      keyInsight: readSection(doc, HEADINGS.keyInsight, warnings),
      struggles: readSection(doc, HEADINGS.struggles, warnings),
      next: readSection(doc, HEADINGS.next, warnings),
      supersedesSeq: inferSupersedes(source),
    },
    warnings,
    unmapped,
  };
}

function parseTitle(h1: string | null, warnings: ParseWarning[]): string | null {
  if (h1 === null) {
    // Recoverable: the caller falls back to the de-slugged filename, because
    // `learning_records.title` is NOT NULL and the filename always has one.
    warnings.push(warn("title_missing"));
    return null;
  }

  const match = H1_TITLE.exec(h1);
  const title = match?.[2]?.trim();
  return title ? title : null;
}

function parseDate(raw: string | null, warnings: ParseWarning[]): string | null {
  if (raw === null) {
    warnings.push(warn("section_missing", { heading: "Date" }));
    return null;
  }

  // Only the bare ISO date is accepted. A best-effort parse of "8 August 2026"
  // would resolve through the server's locale, and a record that lands one day
  // early moves which weekly review it belongs to.
  const candidate = raw.trim().split(/\s+/u)[0] ?? "";
  if (!ISO_DATE.test(candidate)) {
    warnings.push(warn("value_malformed", { field: "date", value: raw.trim() }));
    return null;
  }
  return candidate;
}

/**
 * Find a link to another record on a line that says this one replaces it.
 *
 * Requires **both** signals. A record that merely links to an earlier one — which
 * the format encourages, since insights build on each other — is not superseding
 * it, and treating every backlink as a supersession would retire most of the
 * ledger.
 */
function inferSupersedes(source: string): number | null {
  for (const line of source.replace(/\r\n/gu, "\n").split("\n")) {
    if (!SUPERSEDE_PHRASE.test(line)) continue;

    const matches = [...line.matchAll(RECORD_LINK)];
    // Exactly one candidate, or nothing. Two links on one line is ambiguous, and
    // picking the first would be a coin flip that quietly retires a live record.
    if (matches.length === 1) return Number(matches[0]![1]);
  }
  return null;
}
