import { describe, expect, it } from "vitest";

import { checkReferences, parseLessonHtml, parseReferenceHtml } from "./html.js";
import type { WarningCode } from "./result.js";

const codes = (result: { warnings: readonly { code: WarningCode }[] }): WarningCode[] =>
  result.warnings.map((w) => w.code);

const LESSON = `<!doctype html>
<html lang="en">
  <head>
    <title>Closures and capture</title>
    <link rel="stylesheet" href="../assets/style.css" />
    <script src="../assets/quiz.js"></script>
  </head>
  <body>
    <h1>Closures and capture</h1>
    <p>A closure captures its environment.</p>
    <a href="../reference/ownership.html">Ownership cheat sheet</a>
    <a href="0006-borrowing.html">Previous lesson</a>
    <a href="https://doc.rust-lang.org/book/">The Rust Book</a>
    <a href="#top">Back to top</a>
  </body>
</html>`;

describe("parseLessonHtml", () => {
  it("prefers <title> over <h1>", () => {
    const { parsed } = parseLessonHtml("0007-closures.html", LESSON);

    expect(parsed.title).toBe("Closures and capture");
    expect(codes(parseLessonHtml("0007-closures.html", LESSON))).not.toContain("title_missing");
  });

  it("takes the sequence from the filename, never from the document", () => {
    // §3.2 settles filename-vs-H1 disagreements in the filename's favour: an H1
    // is prose the agent rewrites, the number is the workspace's own ordering,
    // and it is what a learning record links back to.
    const { parsed } = parseLessonHtml("0007-closures.html", "<h1>0042. Something else</h1>");

    expect(parsed.seq).toBe(7);
  });

  it("falls back to the first <h1> and says it had to", () => {
    const result = parseLessonHtml("0007-closures.html", "<h1>Closures</h1><p>text</p>");

    expect(result.parsed.title).toBe("Closures");
    expect(codes(result)).toContain("title_missing");
  });

  it("warns when more than one <h1> made the fallback a choice", () => {
    // Agents bold a section header into an H1 fairly often, which makes the
    // fallback ambiguous rather than wrong. First in document order, and say so.
    const result = parseLessonHtml("0007-x.html", "<h1>Real title</h1><h1>A section</h1>");

    expect(result.parsed.title).toBe("Real title");
    expect(codes(result)).toContain("title_ambiguous");
  });

  it("falls back to the de-slugged filename, because the column is NOT NULL", () => {
    const result = parseLessonHtml("0007-closures-and-capture.html", "<p>no headings</p>");

    expect(result.parsed.title).toBe("Closures And Capture");
    expect(codes(result)).toContain("title_missing");
  });

  it("warns about an unnumbered lesson rather than inventing a sequence", () => {
    // `lessons.seq` is NOT NULL and unique per mission, so the caller has to
    // assign one — and the next free number is a fact about the mission, not
    // about this file.
    const result = parseLessonHtml("closures.html", LESSON);

    expect(result.parsed.seq).toBeNull();
    expect(codes(result)).toContain("filename_unnumbered");
  });

  it("collects relative asset references and ignores absolute ones", () => {
    const { parsed } = parseLessonHtml("0007-closures.html", LESSON);

    expect(parsed.assets).toEqual(["../assets/style.css", "../assets/quiz.js"]);
  });

  it("collects cross-links to other lessons and reference docs", () => {
    // The skill requires lessons to link to each other and to reference docs, so
    // these are a designed feature rather than incidental.
    const { parsed } = parseLessonHtml("0007-closures.html", LESSON);

    expect(parsed.crossLinks).toEqual(["../reference/ownership.html", "0006-borrowing.html"]);
    expect(parsed.crossLinks).not.toContain("https://doc.rust-lang.org/book/");
  });

  it("ignores fragment-only links", () => {
    const { parsed } = parseLessonHtml("0007-closures.html", LESSON);

    expect(parsed.crossLinks).not.toContain("#top");
  });

  it("warns about an empty body, which is a run that stopped mid-turn", () => {
    // Indistinguishable from a finished lesson by size alone, because the head
    // still carries the stylesheet link.
    const result = parseLessonHtml(
      "0007-x.html",
      `<html><head><title>X</title><link href="../assets/style.css"></head><body></body></html>`,
    );

    expect(codes(result)).toContain("value_malformed");
  });

  it("does not attempt to read completion or outcome from the file", () => {
    // They arrive over postMessage from the sandboxed reader (§7.5) and are never
    // in the HTML. A parser that looked would find nothing and could only report
    // zero, which is a measurement claim about a lesson nobody has opened.
    const { parsed } = parseLessonHtml("0007-x.html", LESSON);

    expect(parsed).not.toHaveProperty("completedAt");
    expect(parsed).not.toHaveProperty("outcome");
  });

  it("parses malformed HTML without throwing", () => {
    expect(() => parseLessonHtml("0007-x.html", "<h1>unclosed <p><div>")).not.toThrow();
    expect(() => parseLessonHtml("0007-x.html", "")).not.toThrow();
  });
});

describe("parseReferenceHtml", () => {
  it("does not expect a sequence, because reference docs are not numbered", () => {
    // The skill revises a reference doc in place rather than superseding it, so
    // there is nothing to order — and `reference_docs` has no seq column.
    const result = parseReferenceHtml("ownership.html", "<title>Ownership</title>");

    expect(result.parsed.seq).toBeNull();
    expect(codes(result)).not.toContain("filename_unnumbered");
  });

  it("still slugifies a non-ASCII filename", () => {
    const { parsed } = parseReferenceHtml("café-com-leite.html", "<title>Café</title>");

    expect(parsed.slug).toBe("cafe-com-leite");
  });
});

describe("checkReferences", () => {
  const existing = new Set([
    "assets/style.css",
    "reference/ownership.html",
    "lessons/0006-borrowing.html",
  ]);

  it("passes when every relative reference resolves", () => {
    const { parsed } = parseLessonHtml("0007-closures.html", LESSON);
    const warnings = checkReferences(
      { ...parsed, assets: ["../assets/style.css"], crossLinks: ["../reference/ownership.html"] },
      "lessons/0007-closures.html",
      existing,
    );

    expect(warnings).toEqual([]);
  });

  it("warns about a stylesheet that does not exist", () => {
    // The run had no Bash and no browser, so nothing rendered this file: a link
    // to a missing stylesheet looks exactly like one to a present stylesheet.
    // Still a warning rather than an error — a lesson with no styling is a lesson.
    const { parsed } = parseLessonHtml("0007-x.html", LESSON);
    const warnings = checkReferences(
      { ...parsed, assets: ["../assets/missing.css"], crossLinks: [] },
      "lessons/0007-x.html",
      existing,
    );

    expect(warnings.map((w) => w.code)).toEqual(["link_unresolved"]);
  });

  it("resolves .. against the document's own directory", () => {
    const { parsed } = parseLessonHtml("0007-x.html", LESSON);
    const warnings = checkReferences(
      { ...parsed, assets: [], crossLinks: ["0006-borrowing.html"] },
      "lessons/0007-x.html",
      existing,
    );

    expect(warnings).toEqual([]);
  });

  it("does not warn about a reference that escapes the workspace root", () => {
    // Nothing sane produces one, and reporting "../../etc/passwd is missing" is a
    // worse message than saying nothing. The sync walk is what confines writes.
    const { parsed } = parseLessonHtml("0007-x.html", LESSON);
    const warnings = checkReferences(
      { ...parsed, assets: ["../../../elsewhere.css"], crossLinks: [] },
      "lessons/0007-x.html",
      existing,
    );

    expect(warnings).toEqual([]);
  });
});

describe("the module a lesson declares", () => {
  const withMeta = (head: string) => `<!doctype html>
<html lang="en">
  <head>
    <title>Reading a policy</title>
    ${head}
  </head>
  <body><h1>Reading a policy</h1><p>Words.</p></body>
</html>`;

  it("reads the track and the skills the lesson claims to teach", () => {
    const { parsed } = parseLessonHtml(
      "0007-reading-a-policy.html",
      withMeta(`<meta name="mindforge:track" content="iam-basics" />
      <meta name="mindforge:skill" content="iam-read-policy" />
      <meta name="mindforge:skill" content="iam-principal-model" />`),
    );

    expect(parsed.trackSlug).toBe("iam-basics");
    expect(parsed.skillSlugs).toEqual(["iam-read-policy", "iam-principal-model"]);
  });

  it("leaves the track null when the lesson declares none, without warning", () => {
    // Null is legal and permanent for two cases: lessons written before the
    // mission had a curriculum, and lessons taught deliberately off-plan. Warning
    // about it would make every pre-M4 lesson noisy on the next reindex.
    const { parsed, warnings } = parseLessonHtml("0007-x.html", withMeta(""));

    expect(parsed.trackSlug).toBeNull();
    expect(parsed.skillSlugs).toEqual([]);
    expect(codes({ warnings })).not.toContain("value_duplicated");
  });

  it("slugifies what the tag says, so a near-miss still resolves", () => {
    // The agent writes this tag from the same CURRICULUM.md cell a human might
    // have typed. `IAM Basics` and `iam-basics` are the same track, and the
    // lookup on the other side is by slug.
    const { parsed } = parseLessonHtml(
      "0007-x.html",
      withMeta(`<meta name="mindforge:track" content="IAM Basics" />`),
    );

    expect(parsed.trackSlug).toBe("iam-basics");
  });

  it("takes the first of two track tags and says it had to choose", () => {
    // `lessons.track_id` is one column. Two tags is the agent hedging, and a
    // silent pick would look deliberate.
    const { parsed, warnings } = parseLessonHtml(
      "0007-x.html",
      withMeta(`<meta name="mindforge:track" content="iam-basics" />
      <meta name="mindforge:track" content="vpc-networking" />`),
    );

    expect(parsed.trackSlug).toBe("iam-basics");
    expect(codes({ warnings })).toContain("value_duplicated");
  });

  it("deduplicates repeated skill tags", () => {
    const { parsed } = parseLessonHtml(
      "0007-x.html",
      withMeta(`<meta name="mindforge:skill" content="iam-read-policy" />
      <meta name="mindforge:skill" content="IAM read policy" />`),
    );

    expect(parsed.skillSlugs).toEqual(["iam-read-policy"]);
  });

  it("ignores a tag with an empty or whitespace content attribute", () => {
    const { parsed } = parseLessonHtml(
      "0007-x.html",
      withMeta(`<meta name="mindforge:track" content="  " />
      <meta name="mindforge:skill" content="" />`),
    );

    expect(parsed.trackSlug).toBeNull();
    expect(parsed.skillSlugs).toEqual([]);
  });

  it("still parses the tag on a reference doc, which the caller then ignores", () => {
    // Pinned rather than left implicit. Reference docs are revised in place and
    // shared across tracks — the skill is explicit that these are the artifacts
    // you revisit — so `reference_docs` has no track column, for the same reason
    // it has no seq. The parser does not distinguish the two document kinds here;
    // the reindexer is what drops the value, and this test is the reminder that
    // reading `trackSlug` off a reference doc would be reading something real and
    // storing it nowhere.
    const { parsed } = parseReferenceHtml(
      "iam.html",
      withMeta(`<meta name="mindforge:track" content="iam-basics" />`),
    );

    expect(parsed.trackSlug).toBe("iam-basics");
  });
});

describe("meta tags that carry nothing", () => {
  it("ignores a meta tag with no content attribute at all", () => {
    const { parsed } = parseLessonHtml(
      "0007-x.html",
      `<html><head><title>T</title><meta name="mindforge:track" /></head><body><p>x</p></body></html>`,
    );

    expect(parsed.trackSlug).toBeNull();
  });
});
