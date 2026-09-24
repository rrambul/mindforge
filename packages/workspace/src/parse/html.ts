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

import {
  EXERCISE_SCRIPT_TYPE,
  ExerciseDeclarationSchema,
  type ExerciseDeclaration,
} from "@mindforge/core";
import * as cheerio from "cheerio";

import { deslugify, parseNumberedFilename, slugify } from "../layout.js";
import { warn, type Parsed, type ParseWarning } from "./result.js";

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

/**
 * `<meta name="mindforge:lesson">` — which plan entry this file is.
 *
 * A lesson is generated *from* a row `CURRICULUM.md` planned, and this tag is how
 * the file says which one, so that the plan entry and the written lesson stay one
 * row (§3.2b). Without it the reindexer has a written lesson and an unclaimed plan
 * entry, and the module's fraction counts the same lesson twice — once as done and
 * once as still to come.
 *
 * Null is legal and permanent: a lesson taught off-plan claims nothing, and so
 * does every lesson written before the plan existed.
 */
const LESSON_META = "mindforge:lesson";

/**
 * The most words of explanation a lesson should carry (`skills/LESSON-SHAPE.md`).
 *
 * Kept here beside the counter rather than only in the prose of the skill, so the
 * number the agent is told and the number it is measured against cannot drift
 * apart without a test noticing.
 */
export const PROSE_BUDGET = 800;

/**
 * What is not explanation. Code is read differently from prose and is what a
 * practical lesson is supposed to have more of; the two `data-mindforge` sections
 * are the doing and the debrief, which the budget exempts on purpose.
 */
const NOT_PROSE = [
  "pre",
  "code",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  '[data-mindforge="exercise"]',
  '[data-mindforge="debrief"]',
].join(", ");

/** A token counts as a word only if it has a letter or a digit in it: "→" and "—" are not words. */
const WORD = /[\p{L}\p{N}]/u;

/**
 * `<meta name="mindforge:adjusted">`, `…:adjusted-reason` and `…:bridge-for` — what
 * this lesson changed about the plan (FR-D2–D4).
 *
 * Declared by the lesson, like its track, so that the adaptation lives with the
 * file that embodies it: a bridge lesson regenerated or restored from Storage still
 * says it is a bridge, and toward what.
 */
const ADJUSTED_META = "mindforge:adjusted";
const ADJUSTED_REASON_META = "mindforge:adjusted-reason";
const BRIDGE_FOR_META = "mindforge:bridge-for";
const ADJUSTMENT_KINDS = ["bridge", "harder"] as const;
const REASON_MAX = 500;

export interface LessonAdjustment {
  readonly kind: (typeof ADJUSTMENT_KINDS)[number];
  /** One line for the screen, as the lesson wrote it. Null when it gave none. */
  readonly reason: string | null;
  /** The slug of the lesson a bridge steps toward. Null for `harder`, or a bridge that did not say. */
  readonly bridgeFor: string | null;
}

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
  /**
   * The planned lesson this file claims to be, or null when it claims none.
   *
   * Read the same way as the track tag and for the same reason: the plan entry it
   * names is a row, and the file is what says which.
   */
  readonly planSlug: string | null;
  /** Relative `./assets/…` references, deduplicated and in document order. */
  readonly assets: readonly string[];
  /** Relative links to other lessons and reference docs. */
  readonly crossLinks: readonly string[];
  /**
   * Words of explanation in the body: everything outside code, scripts and the
   * marked exercise and debrief. Measured on reference docs too, but only a
   * lesson is held to `PROSE_BUDGET` — the reference shelf is where the depth a
   * lesson cannot afford is meant to go.
   */
  readonly proseWords: number;
  /**
   * The exercises the lesson declares, in document order (FR-X1). Each is a
   * `<script type="application/vnd.mindforge.exercise+json">` block, validated
   * against `ExerciseDeclarationSchema`; a block that fails is dropped with a
   * warning and the lesson still indexes. Always empty on a reference doc.
   */
  readonly exercises: readonly ExerciseDeclaration[];
  /** What the lesson changed about the plan, or null for a lesson taught as planned. */
  readonly adjustment: LessonAdjustment | null;
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

/**
 * Count the words of explanation in a document.
 *
 * Walks the text nodes rather than calling `.text()`, which concatenates adjacent
 * nodes: `<p>one</p><p>two</p>` reads as "onetwo" and a long lesson undercounts
 * by roughly one word per paragraph — the error in the direction that flatters it.
 */
function countProseWords($: cheerio.CheerioAPI): number {
  const body = $("body").clone();
  body.find(NOT_PROSE).remove();

  let count = 0;
  body
    .find("*")
    .addBack()
    .contents()
    .each((_, node) => {
      // 3 is the DOM's TEXT_NODE; comments and elements are skipped here, and an
      // element's own text is reached through its children.
      if (node.nodeType !== 3) return;
      for (const token of $(node).text().split(/\s+/u)) {
        if (WORD.test(token)) count += 1;
      }
    });

  return count;
}

/**
 * Every exercise block → a declaration, or a warning.
 *
 * Validated here rather than trusted downstream, because the reader maps over
 * whatever this returns and a block the agent half-wrote would otherwise be an
 * exercise panel with no tests to run. Nothing throws: a bad block costs that
 * exercise, never the lesson.
 */
function extractExercises(
  $: cheerio.CheerioAPI,
  filename: string,
  warnings: ParseWarning[],
): ExerciseDeclaration[] {
  const exercises: ExerciseDeclaration[] = [];

  $(`script[type="${EXERCISE_SCRIPT_TYPE}"]`).each((_, element) => {
    let json: unknown;
    try {
      json = JSON.parse($(element).text());
    } catch {
      warnings.push(warn("value_malformed", { field: "exercise", reason: "json", file: filename }));
      return;
    }

    const result = ExerciseDeclarationSchema.safeParse(json);
    if (!result.success) {
      // The first failing field, as a key the UI can name — not zod's prose,
      // which is English baked into a jsonb column (§5.2).
      const reason = String(result.error.issues[0]?.path[0] ?? "shape");
      warnings.push(warn("value_malformed", { field: "exercise", reason, file: filename }));
      return;
    }

    if (exercises.some((e) => e.key === result.data.key)) {
      warnings.push(warn("value_duplicated", { field: "exercise", value: result.data.key }));
      return;
    }
    exercises.push(result.data);
  });

  return exercises;
}

/** The first `content` for a meta name, trimmed and verbatim — not slugified, because it is prose. */
function metaText($: cheerio.CheerioAPI, name: string): string | null {
  const value = $(`meta[name="${name}"]`).first().attr("content")?.trim() ?? "";
  return value === "" ? null : value;
}

function extractAdjustment(
  $: cheerio.CheerioAPI,
  filename: string,
  warnings: ParseWarning[],
): LessonAdjustment | null {
  const declared = metaText($, ADJUSTED_META)?.toLowerCase() ?? null;
  const bridgeFor = metaValues($, BRIDGE_FOR_META)[0] ?? null;

  // Naming a lesson to bridge toward *is* declaring a bridge; a lesson that did one
  // and forgot the other is still a bridge, and saying otherwise would hide it.
  const kind = declared ?? (bridgeFor === null ? null : "bridge");
  if (kind === null) return null;

  if (!(ADJUSTMENT_KINDS as readonly string[]).includes(kind)) {
    warnings.push(warn("value_unknown", { field: ADJUSTED_META, value: kind, file: filename }));
    return null;
  }

  const reason = metaText($, ADJUSTED_REASON_META);
  return {
    kind: kind as LessonAdjustment["kind"],
    reason: reason === null ? null : reason.slice(0, REASON_MAX),
    bridgeFor: kind === "bridge" ? bridgeFor : null,
  };
}

function parseHtml(
  filename: string,
  html: string,
  { expectSeq, budget }: { expectSeq: boolean; budget: number | null },
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

  const proseWords = countProseWords($);
  if (budget !== null && proseWords > budget) {
    // A warning, not a rejection: an over-long lesson is still the lesson. The
    // point is that the run says so, rather than the learner finding out by
    // scrolling.
    warnings.push(warn("prose_over_budget", { words: proseWords, budget }));
  }

  const declared = metaValues($, TRACK_META);
  if (declared.length > 1) {
    // One lesson, one module. Two tags is the agent hedging, and `lessons.track_id`
    // is a single column — taking the first is the same rule a duplicated heading
    // gets, and saying so is what stops it looking deliberate.
    warnings.push(warn("value_duplicated", { field: TRACK_META, value: declared.join(", ") }));
  }

  const claimed = metaValues($, LESSON_META);
  if (claimed.length > 1) {
    // One file cannot be two plan entries. Claiming both would take two rows out
    // of the plan for one lesson, and the module would lose a lesson it still owes.
    warnings.push(warn("value_duplicated", { field: LESSON_META, value: claimed.join(", ") }));
  }

  return {
    parsed: {
      title,
      seq,
      slug,
      trackSlug: declared[0] ?? null,
      planSlug: claimed[0] ?? null,
      assets: [...assets],
      crossLinks: [...crossLinks],
      proseWords,
      // Only a lesson carries exercises; `expectSeq` is what marks one.
      exercises: expectSeq ? extractExercises($, filename, warnings) : [],
      adjustment: expectSeq ? extractAdjustment($, filename, warnings) : null,
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
  return parseHtml(filename, html, { expectSeq: true, budget: PROSE_BUDGET });
}

export function parseReferenceHtml(filename: string, html: string): Parsed<ParsedHtmlDoc> {
  // Reference docs carry no `NNNN`: the skill revises them in place rather than
  // superseding them, so there is nothing to order. `reference_docs` has no `seq`
  // column for the same reason.
  return parseHtml(filename, html, { expectSeq: false, budget: null });
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
