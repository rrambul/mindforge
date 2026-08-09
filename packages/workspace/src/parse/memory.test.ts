import { describe, expect, it } from "vitest";

import { parseLearnerMemory } from "./memory.js";
import type { WarningCode } from "./result.js";

const codes = (result: ReturnType<typeof parseLearnerMemory>): WarningCode[] =>
  result.warnings.map((w) => w.code);

const CANONICAL = `# Retains by building, not by reading

Kind: learning_pattern
Supersedes: prefers-reading

Three sessions where a worked example landed and the prose before it did not.
Lessons should lead with something to run.
`;

describe("parseLearnerMemory", () => {
  it("reads the summary, kind, body and supersession", () => {
    const { parsed } = parseLearnerMemory("retains-by-building.md", CANONICAL);

    expect(parsed).toMatchObject({
      slug: "retains-by-building",
      summary: "Retains by building, not by reading",
      kind: "learning_pattern",
      supersedes: "prefers-reading",
    });
    expect(parsed.body).toContain("worked example landed");
  });

  it("keeps the H1 as the summary, because that is what relevance selection loads", () => {
    // §7.6: one fact per file, with a one-line summary at the top — and that line
    // is what gets injected once the memory outgrows being sent whole.
    const { parsed } = parseLearnerMemory("x.md", CANONICAL);

    expect(parsed.summary).not.toContain("Kind:");
    expect(parsed.body).not.toContain("Retains by building");
  });

  it("infers the kind from §7.6's own filenames when the file does not declare one", () => {
    for (const [filename, kind] of [
      ["background.md", "background"],
      ["teaching-preferences.md", "teaching_preference"],
      ["learning-patterns.md", "learning_pattern"],
      ["constraints.md", "constraint"],
    ] as const) {
      expect(parseLearnerMemory(filename, "# A fact\n\nSomething.\n").parsed.kind).toBe(kind);
    }
  });

  it("falls back to background rather than to a constraint", () => {
    // The least consequential of the four. A fact wrongly filed as a `constraint`
    // has the agent refusing to plan a lesson longer than a limit nobody set.
    const result = parseLearnerMemory("something.md", "# A fact\n\nSomething.\n");

    expect(result.parsed.kind).toBe("background");
    expect(codes(result)).toContain("value_coerced");
  });

  it("warns rather than guessing when the declared kind is unknown", () => {
    const result = parseLearnerMemory("x.md", "# A fact\n\nKind: vibes\n\nSomething.\n");

    expect(result.parsed.kind).toBe("background");
    expect(codes(result)).toContain("value_unknown");
  });

  it("accepts a kind written with spaces or hyphens", () => {
    for (const written of ["learning pattern", "learning-pattern", "Learning_Pattern"]) {
      expect(parseLearnerMemory("x.md", `# A fact\n\nKind: ${written}\n`).parsed.kind).toBe(
        "learning_pattern",
      );
    }
  });

  it("falls back to the filename for a summary, and says so", () => {
    // NOT NULL, and the relevance story depends on it being a sentence — so this
    // warns loudly rather than quietly manufacturing one.
    const result = parseLearnerMemory("prefers-worked-examples.md", "Just a body.\n");

    expect(result.parsed.summary).toBe("prefers worked examples");
    expect(codes(result)).toContain("title_missing");
  });

  it("accepts a memory that is only a summary", () => {
    // "Screen-reader user" needs no elaboration, and demanding a body would push
    // the agent into padding a fact that is already complete.
    const { parsed } = parseLearnerMemory("constraints.md", "# Screen-reader user\n");

    expect(parsed.summary).toBe("Screen-reader user");
    expect(parsed.body).toBe("");
  });

  it("leaves supersedes null when nothing is superseded, without warning", () => {
    // The common case by a long way. A warning on every ordinary memory is a
    // warning nobody reads.
    const result = parseLearnerMemory("x.md", "# A fact\n\nKind: background\n\nSomething.\n");

    expect(result.parsed.supersedes).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it("normalises the superseded slug the same way it normalises its own", () => {
    const { parsed } = parseLearnerMemory("x.md", "# A fact\n\nSupersedes: Prefers Reading\n");

    expect(parsed.supersedes).toBe("prefers-reading");
  });

  it("slugifies a non-ASCII filename", () => {
    expect(parseLearnerMemory("prefere-exemplos-práticos.md", "# X\n").parsed.slug).toBe(
      "prefere-exemplos-praticos",
    );
  });

  it("keeps a prose line that merely looks like a preamble key", () => {
    // Found by running this against a real run rather than a fixture. The agent
    // opened a memory with "Observed: 2026-08-09 (mission: Postgres RLS).
    // Self-reported in MISSION.md constraints, consistent" — a sentence starting
    // with a capitalised word and a colon. Matching any `Word: value` ate half of
    // it and started the body mid-clause, with no warning.
    const { parsed } = parseLearnerMemory(
      "x.md",
      "# A fact\n\nObserved: 2026-08-09 (mission: Postgres RLS). Self-reported,\nand consistent so far.\n",
    );

    expect(parsed.body).toContain("Observed: 2026-08-09");
    expect(parsed.body).toContain("consistent so far");
  });

  it("recognises the filename a real run used for teaching preferences", () => {
    // §7.6's layout says `teaching-preferences.md`; the agent wrote
    // `learning-preferences.md`, which is the same thing said the other way round.
    expect(parseLearnerMemory("learning-preferences.md", "# X\n").parsed.kind).toBe(
      "teaching_preference",
    );
  });

  it("parses an empty file without throwing", () => {
    expect(() => parseLearnerMemory("x.md", "")).not.toThrow();
  });
});
