import { describe, expect, it } from "vitest";
import { parseChangelogBody, parseSpans } from "./changelog-markdown.js";

describe("parseSpans", () => {
  it("reads bold and code, and leaves everything else as text", () => {
    expect(parseSpans("Set **target minutes** with `pnpm dev`")).toEqual([
      { text: "Set " },
      { text: "target minutes", emphasis: "strong" },
      { text: " with " },
      { text: "pnpm dev", emphasis: "code" },
    ]);
  });

  it("keeps two bold runs on one line as two", () => {
    const spans = parseSpans("**One.** and **two.**");
    expect(spans.filter((span) => span.emphasis === "strong")).toHaveLength(2);
  });

  it("leaves a stray asterisk alone rather than swallowing the rest of the line", () => {
    expect(parseSpans("2 * 3 is 6")).toEqual([{ text: "2 * 3 is 6" }]);
  });
});

describe("parseChangelogBody", () => {
  it("reads a heading, a paragraph, and a list", () => {
    const blocks = parseChangelogBody("### The weekly rhythm\n\nSome prose.\n\n- One\n- Two\n");

    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "list"]);
    expect(blocks[2]).toEqual({ kind: "list", items: [[{ text: "One" }], [{ text: "Two" }]] });
  });

  it("joins a wrapped bullet back into one item", () => {
    // CHANGELOG.md is hard-wrapped at 100 columns, so nearly every bullet arrives as several lines.
    // Left split, each wrap would become a line break — on a phone, in a third of the width.
    const blocks = parseChangelogBody("- **Weekly plans.** Set target minutes\n  for a week.\n");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "list" });
    const [block] = blocks;
    const text = block?.kind === "list" ? (block.items[0] ?? []).map((s) => s.text).join("") : "";
    expect(text).toBe("Weekly plans. Set target minutes for a week.");
  });

  it("joins a wrapped paragraph too", () => {
    const blocks = parseChangelogBody("The first release\nwith a version at all.\n");
    expect(blocks).toEqual([
      { kind: "paragraph", spans: [{ text: "The first release with a version at all." }] },
    ]);
  });

  it("keeps text it does not understand rather than dropping it", () => {
    // A parser that discarded the unrecognised would lose release notes silently, and a changelog
    // with a hole in it is worse than one with a stray character.
    const blocks = parseChangelogBody("| a | b |\n");
    expect(blocks).toEqual([{ kind: "paragraph", spans: [{ text: "| a | b |" }] }]);
  });

  it("returns nothing for an empty body", () => {
    expect(parseChangelogBody("")).toEqual([]);
    expect(parseChangelogBody("\n\n  \n")).toEqual([]);
  });
});
