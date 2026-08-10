/**
 * `lessons/NNNN-slug.html` and `reference/slug.html` → their index rows
 * (FR-T4, FR-T5).
 *
 * These files are the only ones the agent writes that nothing ever validated.
 * The server run has no `Bash` tool and no browser, so the HTML was never
 * rendered, the inline JavaScript was never executed, and a `<link>` to a
 * stylesheet that does not exist looks exactly like one that does. That is not a
 * reason to reject the file — a broken lesson is still content, and losing it
 * would be much worse — but it is a reason to say so. The smoke checks here
 * become run warnings, which is the difference between "your lesson has no
 * stylesheet" and finding out by opening it in three weeks.
 *
 * Completion and outcome are deliberately absent. They arrive at runtime over
 * `postMessage` from the sandboxed reader (§7.5) and are never in the file — a
 * parser that looked for them would find nothing and could only report zero,
 * which is a measurement claim about a lesson nobody has opened.
 */

import * as cheerio from "cheerio";

import { deslugify, parseNumberedFilename, slugify } from "../layout.js";
import { type Parsed, type ParseWarning, warn } from "./result.js";

/**
 * `<meta name="mindforge:track">` — which module this lesson belongs to.
 *
 * Membership lives in the lesson rather than in `CURRICULUM.md` on purpose. The
 * agent rewrites index files wholesale, which is what made `RESOURCES.md` double
 * the library until its upsert key was fixed; a self-describing lesson survives a
 * regenerated curriculum, a renamed track, and a local `/teach` run that knew
 * nothing about either.
 */
const TRACK_META = "mindforge:track";

/** `<meta name="mindforge:skill">`, repeatable — what the lesson actually taught. */
const SKILL_META = "mindforge:skill";

export interface ParsedHtmlDoc {
  /** Never null: the fallback chain ends at the de-slugged filename. */
  readonly title: string;
  /** From the filename. Null on a reference doc, which the skill does not number. */
  readonly seq: number | null;
  readonly slug: string;
  /**
   * The track slug this lesson declares, or null.
   *
   * Null is legal and permanent for lessons written before the mission had a
   * curriculum and for lessons taught deliberately off-plan — so the absence is
   * not warned about on reference docs, and is only a soft signal on lessons.
   */
  readonly trackSlug: string | null;
  /** Skill slugs the lesson claims to teach, deduplicated and in document order. */
  readonly skillSlugs: readonly string[];
  /** Relative `./assets/…` references, deduplicated and in document order. */
  readonly assets: readonly string[];
  /** Relative links to other lessons and reference docs. */
  readonly crossLinks: readonly string[];
}

/** Attributes that can carry a reference to another file in the workspace. */
const REFERENCE_ATTRIBUTES = [
  ["link", "href"],
  ["script", "src"],
  ["img", "src"],
  ["a", "href"],
  ["source", "src"],
  ["iframe", "src"],
] as const;

function isRelative(reference: string): boolean {
  if (reference === "") return false;
  if (reference.startsWith("#")) return false;
  if (reference.startsWith("data:")) return false;
  return !/^[a-z][a-z0-9+.-]*:/iu.test(reference) && !reference.startsWith("//");
}

/**
 * Extract a title, warning about the ways the document makes that ambiguous.
 *
 * `<title>` first, per §7.4's parser table. Falling back to `<h1>` is common and
 * fine, but a lesson often has more than one — the agent bolds a section header
 * into an H1 — so the fallback takes the first in document order and says that it
 * had to choose.
 */
function extractTitle(
  $: cheerio.CheerioAPI,
  filenameSlug: string,
  warnings: ParseWarning[],
): string {
  const titleTag = $("title").first().text().trim();
  if (titleTag !== "") return titleTag;

  const headings = $("h1");
  if (headings.length > 0) {
    warnings.push(warn("title_missing", { source: "h1" }));
    if (headings.length > 1) {
      warnings.push(warn("title_ambiguous", { count: headings.length }));
    }
    const first = headings.first().text().trim();
    if (first !== "") return first;
  }

  // `lessons.title` and `reference_docs.title` are both NOT NULL, so the chain
  // has to terminate somewhere that always exists. The filename always does.
  warnings.push(warn("title_missing", { source: "filename" }));
  return deslugify(filenameSlug);
}

function parseHtml(
  filename: string,
  html: string,
  { expectSeq }: { expectSeq: boolean },
): Parsed<ParsedHtmlDoc> {
  const warnings: ParseWarning[] = [];
  const { seq, slug } = parseNumberedFilename(filename);

  if (expectSeq && seq === null) {
    // Recoverable but load-bearing: `lessons.seq` is NOT NULL and unique per
    // mission, so the caller has to assign one. Warning rather than inventing it
    // here, because the next free number is a fact about the mission, not the file.
    warnings.push(warn("filename_unnumbered", { filename }));
  }

  const $ = cheerio.load(html);
  const title = extractTitle($, slug, warnings);

  const assets = new Set<string>();
  const crossLinks = new Set<string>();

  for (const [tag, attribute] of REFERENCE_ATTRIBUTES) {
    $(`${tag}[${attribute}]`).each((_, element) => {
      const reference = $(element).attr(attribute)?.trim() ?? "";
      if (!isRelative(reference)) return;

      const withoutFragment = reference.split("#")[0]!;
      if (withoutFragment === "") return;

      if (/(^|\/)assets\//u.test(withoutFragment)) assets.add(withoutFragment);
      else if (/\.html?$/iu.test(withoutFragment)) crossLinks.add(withoutFragment);
    });
  }

  // The cheapest possible "did this render" check. An empty body with references
  // in the head is a file the agent started and abandoned mid-turn, and it is
  // indistinguishable from a finished one by size alone.
  if ($("body").text().trim() === "") {
    warnings.push(warn("value_malformed", { field: "body", reason: "empty" }));
  }

  const declared = metaValues($, TRACK_META);
  if (declared.length > 1) {
    // One lesson, one module. Two tags is the agent hedging, and `lessons.track_id`
    // is a single column — taking the first is the same rule a duplicated heading
    // gets, and saying so is what stops it looking deliberate.
    warnings.push(warn("value_duplicated", { field: TRACK_META, value: declared.join(", ") }));
  }

  return {
    parsed: {
      title,
      seq,
      slug,
      trackSlug: declared[0] ?? null,
      skillSlugs: metaValues($, SKILL_META),
      assets: [...assets],
      crossLinks: [...crossLinks],
    },
    warnings,
    unmapped: {},
  };
}

/**
 * Every `<meta name="…" content="…">` for a name, slugified and deduplicated.
 *
 * Slugified rather than taken verbatim because the agent writes the tag from the
 * same `CURRICULUM.md` cell a human might have typed, and `IAM Basics` and
 * `iam-basics` are the same track. The lookup on the other side is by slug, so
 * normalising here is what makes a near-miss resolve instead of silently
 * orphaning the lesson.
 */
function metaValues($: cheerio.CheerioAPI, name: string): string[] {
  const values: string[] = [];

  $(`meta[name="${name}"]`).each((_, element) => {
    const slug = slugify($(element).attr("content")?.trim() ?? "");
    if (slug !== "" && !values.includes(slug)) values.push(slug);
  });

  return values;
}

export function parseLessonHtml(filename: string, html: string): Parsed<ParsedHtmlDoc> {
  return parseHtml(filename, html, { expectSeq: true });
}

export function parseReferenceHtml(filename: string, html: string): Parsed<ParsedHtmlDoc> {
  // Reference docs carry no `NNNN`: the skill revises them in place rather than
  // superseding them, so there is nothing to order. `reference_docs` has no `seq`
  // column for the same reason.
  return parseHtml(filename, html, { expectSeq: false });
}

/**
 * Check a parsed document's relative references against what the workspace
 * actually contains.
 *
 * Separate from parsing because it needs the file list, and parsing is a function
 * of one file's bytes. Every result is a warning: §7.4's degradation rule is
 * "stored, partially indexed", and a lesson whose stylesheet is missing is still
 * the lesson.
 */
export function checkReferences(
  doc: ParsedHtmlDoc,
  documentPath: string,
  existingPaths: ReadonlySet<string>,
): readonly ParseWarning[] {
  const warnings: ParseWarning[] = [];
  const base = documentPath.split("/").slice(0, -1);

  for (const reference of [...doc.assets, ...doc.crossLinks]) {
    const resolved = resolveRelative(base, reference);
    if (resolved !== null && !existingPaths.has(resolved)) {
      warnings.push(warn("link_unresolved", { from: documentPath, to: reference }));
    }
  }

  return warnings;
}

/** Resolve `../reference/x.html` against a directory, or null if it escapes the workspace. */
function resolveRelative(baseSegments: readonly string[], reference: string): string | null {
  const segments = [...baseSegments];

  for (const part of reference.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(part);
  }

  return segments.join("/");
}
