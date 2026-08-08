import { describe, expect, it } from "vitest";

import { parseResources } from "./resources.js";
import type { WarningCode } from "./result.js";

const codes = (result: ReturnType<typeof parseResources>): WarningCode[] =>
  result.warnings.map((w) => w.code);

const CANONICAL = `# Resources

## Primary Sources

| Resource | Type | Trust | Why it's here |
| -------- | ---- | ----- | ------------- |
| [The Rust Book](https://doc.rust-lang.org/book/) | docs | high | The canonical reference |
| [Crust of Rust](https://youtube.com/x) | video | medium | Deep dives on ownership |

## Communities

| Community | Where | Why it's here |
| --------- | ----- | ------------- |
| [r/rust](https://reddit.com/r/rust) | subreddit | Active and friendly |

## Explored But Rejected

- [Rust in 5 Minutes](https://example.com/quick) — Too shallow to ground anything
`;

describe("parseResources", () => {
  it("reads the primary sources table", () => {
    const { parsed } = parseResources(CANONICAL);

    expect(parsed.primary).toEqual([
      {
        title: "The Rust Book",
        url: "https://doc.rust-lang.org/book/",
        type: "docs",
        trust: "high",
        note: "The canonical reference",
      },
      {
        title: "Crust of Rust",
        url: "https://youtube.com/x",
        type: "video",
        trust: "medium",
        note: "Deep dives on ownership",
      },
    ]);
  });

  describe("binding cells by header name rather than position", () => {
    it("survives a reordered table", () => {
      // The single most likely silent-corruption source in this file. With
      // positional binding, a swapped Trust and Type files "high" as the resource
      // type and coerces it to `article` — and the library looks fine.
      const { parsed } = parseResources(
        `# Resources\n\n## Primary Sources\n\n` +
          `| Resource | Trust | Type |\n| - | - | - |\n` +
          `| [X](https://x.dev) | high | book |\n`,
      );

      expect(parsed.primary[0]).toMatchObject({ type: "book", trust: "high" });
    });

    it("survives an added column, and keeps what it could not place", () => {
      const result = parseResources(
        `# Resources\n\n## Primary Sources\n\n` +
          `| Resource | Type | Status | Trust |\n| - | - | - | - |\n` +
          `| [X](https://x.dev) | book | reading | high |\n`,
      );

      expect(result.parsed.primary[0]).toMatchObject({ type: "book", trust: "high" });
      expect(result.unmapped["Primary Sources/X/Status"]).toBe("reading");
      expect(codes(result)).toContain("section_unknown");
    });

    it("leaves a missing column null rather than shifting the others", () => {
      const { parsed } = parseResources(
        `# Resources\n\n## Primary Sources\n\n` +
          `| Resource | Why it's here |\n| - | - |\n` +
          `| [X](https://x.dev) | Because |\n`,
      );

      expect(parsed.primary[0]).toMatchObject({ trust: null, note: "Because" });
    });

    it("refuses to guess when there is no resource column at all", () => {
      const result = parseResources(
        `# Resources\n\n## Primary Sources\n\n| A | B |\n| - | - |\n| x | y |\n`,
      );

      expect(result.parsed.primary).toEqual([]);
      expect(codes(result)).toContain("value_malformed");
    });
  });

  describe("type, which is NOT NULL and has a wider vocabulary than the doc", () => {
    it("accepts the three types the format doc never mentions", () => {
      // The doc lists book / video / course / docs; the column permits seven.
      const { parsed } = parseResources(table("podcast", "high"));
      expect(parsed.primary[0]!.type).toBe("podcast");
    });

    it("coerces an unrecognised type instead of nulling a NOT NULL column", () => {
      const result = parseResources(table("interpretive dance", "high"));

      expect(result.parsed.primary[0]!.type).toBe("article");
      expect(codes(result)).toContain("value_coerced");
    });

    it("maps the words a model actually writes", () => {
      expect(parseResources(table("blog post", "high")).parsed.primary[0]!.type).toBe("article");
      expect(parseResources(table("YouTube", "high")).parsed.primary[0]!.type).toBe("video");
      expect(parseResources(table("documentation", "high")).parsed.primary[0]!.type).toBe("docs");
    });

    it("handles a cell that copied the doc's own slash-separated vocabulary", () => {
      expect(parseResources(table("book / video / course", "high")).parsed.primary[0]!.type).toBe(
        "book",
      );
    });

    it("coerces an empty type cell rather than failing the row", () => {
      const result = parseResources(table("", "high"));

      expect(result.parsed.primary[0]!.type).toBe("article");
      expect(codes(result)).toContain("value_coerced");
    });
  });

  describe("trust, which grounds every lesson", () => {
    it("accepts low, which the format doc omits and the column permits", () => {
      expect(parseResources(table("book", "low")).parsed.primary[0]!.trust).toBe("low");
    });

    it("nulls an unparseable trust rather than guessing one", () => {
      // The one field where a wrong value is worse than no value: it is what the
      // teaching claims to be grounded in, and §7.3a caps a landing page at
      // `medium` for the same reason.
      const result = parseResources(table("book", "quite good actually"));

      expect(result.parsed.primary[0]!.trust).toBeNull();
      expect(codes(result)).toContain("value_unknown");
    });

    it("leaves an empty trust null without warning", () => {
      const result = parseResources(table("book", ""));

      expect(result.parsed.primary[0]!.trust).toBeNull();
      expect(codes(result)).not.toContain("value_unknown");
    });
  });

  describe("## Explored But Rejected", () => {
    it("reads a bullet split on the em dash", () => {
      const { parsed } = parseResources(CANONICAL);

      expect(parsed.rejected).toEqual([
        {
          title: "Rust in 5 Minutes",
          url: "https://example.com/quick",
          reason: "Too shallow to ground anything",
        },
      ]);
    });

    it("splits after the link, not on the first dash in the title", () => {
      // "Rust By Example - Chapter 3" loses its chapter to any parser that splits
      // on the first dash it sees. The separator is only meaningful after the
      // closing paren of the markdown link.
      const { parsed } = parseResources(
        rejected("- [Rust By Example - Chapter 3](https://x.dev) — Covered elsewhere"),
      );

      expect(parsed.rejected[0]).toEqual({
        title: "Rust By Example - Chapter 3",
        url: "https://x.dev",
        reason: "Covered elsewhere",
      });
    });

    it("accepts the separators agents write instead of an em dash", () => {
      for (const separator of ["—", "–", "--", "-", ":"]) {
        const { parsed } = parseResources(
          rejected(`- [X](https://x.dev) ${separator} Too shallow`),
        );
        expect(parsed.rejected[0]!.reason).toBe("Too shallow");
      }
    });

    it("keeps a bullet with no reason, and says the reason was missing", () => {
      // The list's job is to stop the same weak resource being re-evaluated next
      // session. It does that with or without the why.
      const result = parseResources(rejected("- Some Blog Nobody Rates"));

      expect(result.parsed.rejected[0]).toEqual({
        title: "Some Blog Nobody Rates",
        url: null,
        reason: null,
      });
      expect(codes(result)).toContain("value_malformed");
    });

    it("reads an unlinked bullet that still has a reason", () => {
      const { parsed } = parseResources(rejected("- Some Blog — Out of date"));

      expect(parsed.rejected[0]).toEqual({ title: "Some Blog", url: null, reason: "Out of date" });
    });
  });

  it("retains ## Communities rather than filing a subreddit as an article", () => {
    // One of the skill's three pillars — knowledge, skills, wisdom — with no
    // table to land in until M6 at the earliest. None of the seven resource types
    // fits "forum / subreddit / local group", and coercing it to `article` would
    // put r/rust in the reading queue.
    const result = parseResources(CANONICAL);

    expect(result.parsed.primary.map((r) => r.title)).not.toContain("r/rust");
    expect(result.unmapped["Communities"]).toContain("r/rust");
    expect(codes(result)).toContain("section_unknown");
  });

  it("returns nothing for a section that is not a table, without throwing", () => {
    const result = parseResources("# Resources\n\n## Primary Sources\n\nJust some prose.\n");

    expect(result.parsed.primary).toEqual([]);
    expect(codes(result)).toContain("value_malformed");
  });

  it("ignores a table with no delimiter row rather than reading its header as data", () => {
    const result = parseResources(
      `# Resources\n\n## Primary Sources\n\n| Resource | Type |\n| [X](https://x.dev) | book |\n`,
    );

    expect(result.parsed.primary).toEqual([]);
  });

  it("parses an empty file without throwing", () => {
    expect(() => parseResources("")).not.toThrow();
    expect(parseResources("").parsed).toEqual({ primary: [], rejected: [] });
  });
});

function table(type: string, trust: string): string {
  return (
    `# Resources\n\n## Primary Sources\n\n` +
    `| Resource | Type | Trust |\n| - | - | - |\n` +
    `| [X](https://x.dev) | ${type} | ${trust} |\n`
  );
}

function rejected(bullet: string): string {
  return `# Resources\n\n## Explored But Rejected\n\n${bullet}\n`;
}
