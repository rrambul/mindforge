import { EXERCISE_SCRIPT_TYPE } from "@mindforge/core";
import { describe, expect, it } from "vitest";

import { checkReferences, parseLessonHtml, parseReferenceHtml, PROSE_BUDGET } from "./html.js";
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

  it("reads the track the lesson declares", () => {
    const { parsed } = parseLessonHtml(
      "0007-reading-a-policy.html",
      withMeta(`<meta name="mindforge:track" content="iam-basics" />`),
    );

    expect(parsed.trackSlug).toBe("iam-basics");
  });

  it("leaves the track null when the lesson declares none, without warning", () => {
    // Null is legal and permanent for two cases: lessons written before the
    // mission had a curriculum, and lessons taught deliberately off-plan. Warning
    // about it would make every pre-M4 lesson noisy on the next reindex.
    const { parsed, warnings } = parseLessonHtml("0007-x.html", withMeta(""));

    expect(parsed.trackSlug).toBeNull();
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

  it("ignores a tag with an empty or whitespace content attribute", () => {
    const { parsed } = parseLessonHtml(
      "0007-x.html",
      withMeta(`<meta name="mindforge:track" content="  " />`),
    );

    expect(parsed.trackSlug).toBeNull();
  });

  it("reads the plan entry the lesson claims", () => {
    const { parsed } = parseLessonHtml(
      "0007-reading-a-policy.html",
      withMeta(`<meta name="mindforge:track" content="iam-basics" />
      <meta name="mindforge:lesson" content="policy-reading" />`),
    );

    expect(parsed).toMatchObject({ trackSlug: "iam-basics", planSlug: "policy-reading" });
  });

  it("leaves the plan entry null when the lesson claims none, without warning", () => {
    // Off-plan is legal and permanent, exactly as an absent track tag is. The
    // lesson still indexes; it just does not consume an entry in the plan.
    const { parsed, warnings } = parseLessonHtml("0007-x.html", withMeta(""));

    expect(parsed.planSlug).toBeNull();
    expect(codes({ warnings })).not.toContain("value_duplicated");
  });

  it("takes the first of two plan claims and says it had to choose", () => {
    // One file cannot be two plan entries. Claiming both would take two rows out
    // of the plan for one lesson, and the module would lose one it still owes.
    const { parsed, warnings } = parseLessonHtml(
      "0007-x.html",
      withMeta(`<meta name="mindforge:lesson" content="policy-reading" />
      <meta name="mindforge:lesson" content="policy-writing" />`),
    );

    expect(parsed.planSlug).toBe("policy-reading");
    expect(codes({ warnings })).toContain("value_duplicated");
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

describe("the prose budget", () => {
  // LESSON-SHAPE.md caps a lesson's explanation at PROSE_BUDGET words. This is the
  // number that says whether lessons actually got shorter, so it counts what the
  // learner reads as explanation and nothing else.
  const words = (count: number): string => Array.from({ length: count }, () => "word").join(" ");
  const lesson = (body: string): string =>
    `<html><head><title>T</title></head><body>${body}</body></html>`;

  it("counts the words of explanation in the body", () => {
    const { parsed } = parseLessonHtml("0001-x.html", lesson(`<p>${words(12)}</p>`));

    expect(parsed.proseWords).toBe(12);
  });

  it("does not run words together across block boundaries", () => {
    // cheerio's `.text()` concatenates adjacent text nodes, so "</p><p>" would
    // join the last word of one paragraph to the first of the next and undercount.
    const { parsed } = parseLessonHtml(
      "0001-x.html",
      lesson("<p>one two</p><p>three</p><li>four</li>"),
    );

    expect(parsed.proseWords).toBe(4);
  });

  it("leaves out code, scripts, styles and the head", () => {
    const html = `<html><head><title>${words(5)}</title><style>p { color: red }</style></head><body>
      <p>${words(3)}</p>
      <pre>${words(50)}</pre>
      <p>Call <code>${words(4)}</code> here</p>
      <script>const words = "${words(20)}";</script>
      <noscript>${words(9)}</noscript>
    </body></html>`;

    expect(parseLessonHtml("0001-x.html", html).parsed.proseWords).toBe(5);
  });

  it("leaves out the marked exercise and debrief", () => {
    const html = lesson(`
      <p>${words(10)}</p>
      <section data-mindforge="exercise"><p>${words(300)}</p></section>
      <section data-mindforge="debrief"><p>${words(40)}</p></section>
    `);

    expect(parseLessonHtml("0001-x.html", html).parsed.proseWords).toBe(10);
  });

  it("counts only tokens that contain a letter or a digit", () => {
    // An arrow, a dash or a bullet between two words is not a third word.
    const { parsed } = parseLessonHtml("0001-x.html", lesson("<p>before → after — 2 · end</p>"));

    expect(parsed.proseWords).toBe(4);
  });

  it("stays silent at the budget and warns one word over it", () => {
    const at = parseLessonHtml("0001-x.html", lesson(`<p>${words(PROSE_BUDGET)}</p>`));
    const over = parseLessonHtml("0001-x.html", lesson(`<p>${words(PROSE_BUDGET + 1)}</p>`));

    expect(codes(at)).not.toContain("prose_over_budget");
    expect(over.warnings).toContainEqual({
      code: "prose_over_budget",
      args: { words: PROSE_BUDGET + 1, budget: PROSE_BUDGET },
    });
  });

  it("never warns on a reference document, which is meant to hold the depth", () => {
    // LESSON-SHAPE.md sends the explanation a lesson cannot afford to the
    // reference shelf. Flagging it there would punish the agent for doing so.
    const result = parseReferenceHtml(
      "ownership.html",
      lesson(`<p>${words(PROSE_BUDGET * 3)}</p>`),
    );

    expect(codes(result)).not.toContain("prose_over_budget");
  });
});

describe("the exercises a lesson declares", () => {
  const exercise = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
      key: "retry-backoff",
      kind: "code",
      language: "javascript",
      title: "Retry with backoff",
      prompt: "Write retry().",
      starter: "export function retry() {}",
      tests: 'import { retry } from "./solution";',
      ...over,
    });
  const block = (json: string): string => `<script type="${EXERCISE_SCRIPT_TYPE}">${json}</script>`;
  const lesson = (body: string): string =>
    `<html><head><title>T</title></head><body><p>Intro</p>${body}</body></html>`;

  it("reads each block into a declaration, in document order", () => {
    const html = lesson(
      block(exercise()) + block(exercise({ key: "jitter", title: "Add jitter" })),
    );
    const { parsed, warnings } = parseLessonHtml("0001-x.html", html);

    expect(parsed.exercises.map((e) => e.key)).toEqual(["retry-backoff", "jitter"]);
    expect(parsed.exercises[0]!.solution).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("has none when the lesson declares none, which is every lesson before Phase 1", () => {
    expect(parseLessonHtml("0001-x.html", lesson("")).parsed.exercises).toEqual([]);
  });

  it("keeps the lesson and drops a block that is not JSON, and says so", () => {
    // A broken exercise is still a lesson worth reading (§7.4: stored, partially
    // indexed). Losing the lesson over one block would be the worse failure.
    const { parsed, warnings } = parseLessonHtml("0001-x.html", lesson(block("{ not json")));

    expect(parsed.exercises).toEqual([]);
    expect(parsed.title).toBe("T");
    expect(warnings).toContainEqual({
      code: "value_malformed",
      args: { field: "exercise", reason: "json", file: "0001-x.html" },
    });
  });

  it("drops a block that does not match the contract and names the field", () => {
    const { parsed, warnings } = parseLessonHtml(
      "0001-x.html",
      lesson(block(exercise({ tests: "" })) + block(exercise({ key: "ok" }))),
    );

    expect(parsed.exercises.map((e) => e.key)).toEqual(["ok"]);
    expect(warnings).toContainEqual({
      code: "value_malformed",
      args: { field: "exercise", reason: "tests", file: "0001-x.html" },
    });
  });

  it("keeps the first of two blocks with the same key", () => {
    // Attempts are recorded against the key, so two exercises sharing one would
    // pool their attempts into a history that belongs to neither.
    const { parsed, warnings } = parseLessonHtml(
      "0001-x.html",
      lesson(block(exercise({ title: "First" })) + block(exercise({ title: "Second" }))),
    );

    expect(parsed.exercises.map((e) => e.title)).toEqual(["First"]);
    expect(warnings).toContainEqual({
      code: "value_duplicated",
      args: { field: "exercise", value: "retry-backoff" },
    });
  });

  it("does not count the declaration as prose", () => {
    const html = lesson(block(exercise({ prompt: Array(900).fill("word").join(" ") })));

    expect(parseLessonHtml("0001-x.html", html).parsed.proseWords).toBe(1);
  });

  it("ignores ordinary scripts", () => {
    const html = lesson(`<script>const exercise = ${exercise()};</script>`);

    expect(parseLessonHtml("0001-x.html", html).parsed.exercises).toEqual([]);
  });
});

describe("what a lesson changed about the plan", () => {
  const lesson = (head: string): string =>
    `<html><head><title>T</title>${head}</head><body><p>x</p></body></html>`;
  const meta = (name: string, content: string) => `<meta name="${name}" content="${content}">`;

  it("is null for a lesson taught as planned", () => {
    expect(parseLessonHtml("0002-x.html", lesson("")).parsed.adjustment).toBeNull();
  });

  it("reads a bridge, the lesson it steps toward, and its reason verbatim", () => {
    const { parsed } = parseLessonHtml(
      "0006-smaller-step.html",
      lesson(
        meta("mindforge:adjusted", "bridge") +
          meta("mindforge:bridge-for", "Commit Index") +
          meta("mindforge:adjusted-reason", "You never passed the commit-index exercise."),
      ),
    );

    expect(parsed.adjustment).toEqual({
      kind: "bridge",
      bridgeFor: "commit-index",
      reason: "You never passed the commit-index exercise.",
    });
  });

  it("calls a lesson that names a target a bridge, even when it forgot to say so", () => {
    const { parsed } = parseLessonHtml(
      "0006-x.html",
      lesson(meta("mindforge:bridge-for", "commit-index")),
    );

    expect(parsed.adjustment).toEqual({ kind: "bridge", bridgeFor: "commit-index", reason: null });
  });

  it("reads a push, which has no target", () => {
    const { parsed } = parseLessonHtml(
      "0007-x.html",
      lesson(meta("mindforge:adjusted", "Harder") + meta("mindforge:bridge-for", "ignored")),
    );

    expect(parsed.adjustment).toEqual({ kind: "harder", bridgeFor: null, reason: null });
  });

  it("drops an adjustment it does not know, and says so", () => {
    const result = parseLessonHtml("0007-x.html", lesson(meta("mindforge:adjusted", "easier")));

    expect(result.parsed.adjustment).toBeNull();
    expect(result.warnings).toContainEqual({
      code: "value_unknown",
      args: { field: "mindforge:adjusted", value: "easier", file: "0007-x.html" },
    });
  });

  it("keeps a reason to one screen line's worth", () => {
    const { parsed } = parseLessonHtml(
      "0007-x.html",
      lesson(
        meta("mindforge:adjusted", "harder") + meta("mindforge:adjusted-reason", "x".repeat(900)),
      ),
    );

    expect(parsed.adjustment?.reason).toHaveLength(500);
  });
});

describe("a whiteboard exercise", () => {
  const block = (json: object) =>
    `<html><head><title>T</title></head><body><p>x</p><script type="${EXERCISE_SCRIPT_TYPE}">${JSON.stringify(json)}</script></body></html>`;
  const board = {
    key: "url-shortener",
    kind: "whiteboard",
    title: "Design a URL shortener",
    prompt: "Draw the read and write paths.",
    rubric: ["Separates reads from writes", "Caches hot redirects"],
  };

  it("is read with its rubric, and needs no tests", () => {
    const { parsed, warnings } = parseLessonHtml("0003-x.html", block(board));

    expect(parsed.exercises).toEqual([{ ...board, solution: null, expectedMinutes: null }]);
    expect(warnings).toEqual([]);
  });

  it("is dropped with a warning when its rubric is a single line", () => {
    // One item is a verdict, not a checklist: there is nothing to be partly right about.
    const { parsed, warnings } = parseLessonHtml("0003-x.html", block({ ...board, rubric: ["x"] }));

    expect(parsed.exercises).toEqual([]);
    expect(warnings).toContainEqual({
      code: "value_malformed",
      args: { field: "exercise", reason: "rubric", file: "0003-x.html" },
    });
  });
});

describe("a task exercise", () => {
  const block = (json: object) =>
    `<html><head><title>T</title></head><body><p>x</p><script type="${EXERCISE_SCRIPT_TYPE}">${JSON.stringify(json)}</script></body></html>`;
  const task = {
    key: "gen-counter",
    kind: "task",
    title: "A counter",
    prompt: "Write it.",
    language: "elixir",
    files: [{ path: "lib/counter.ex", contents: "defmodule Counter do\nend\n" }],
    command: "mix test",
  };

  it("is read with its files and command", () => {
    const { parsed, warnings } = parseLessonHtml("0004-x.html", block(task));

    expect(parsed.exercises).toEqual([{ ...task, solution: null, expectedMinutes: null }]);
    expect(warnings).toEqual([]);
  });

  it.each(["/etc/passwd", "../outside.ex", "lib/../../x.ex", "lib\\\\win.ex"])(
    "is dropped when a file path leaves the project: %s",
    (path) => {
      const { parsed, warnings } = parseLessonHtml(
        "0004-x.html",
        block({ ...task, files: [{ path, contents: "" }] }),
      );

      expect(parsed.exercises).toEqual([]);
      expect(warnings[0]).toMatchObject({ code: "value_malformed", args: { reason: "files" } });
    },
  );
});
