import { describe, expect, it } from "vitest";

import { parseLearningRecord } from "./record.js";
import type { WarningCode } from "./result.js";

const codes = (result: ReturnType<typeof parseLearningRecord>): WarningCode[] =>
  result.warnings.map((w) => w.code);

const CANONICAL = `# 0007. Policies do not apply to the table owner

Date: 2026-08-08
Lesson: ../lessons/0007-rls-basics.html

## What Was Learned

A Postgres policy is not consulted for a role that owns the table.

## Evidence

Reproduced it: the same query returned every user's rows as postgres.

## Key Insight

Setting request.jwt.claims without switching role changes nothing at all.

## Struggles

Spent an hour assuming the policy predicate was wrong.

## Next

How SET LOCAL interacts with a connection pool.
`;

describe("parseLearningRecord", () => {
  it("reads every section and both preamble lines", () => {
    const { parsed } = parseLearningRecord(CANONICAL);

    expect(parsed).toMatchObject({
      title: "Policies do not apply to the table owner",
      date: "2026-08-08",
      lessonRef: "../lessons/0007-rls-basics.html",
    });
    expect(parsed.whatLearned).toContain("not consulted for a role");
    expect(parsed.evidence).toContain("Reproduced it");
    expect(parsed.keyInsight).toContain("without switching role");
    expect(parsed.struggles).toContain("Spent an hour");
    expect(parsed.next).toContain("connection pool");
  });

  it("strips the leading NNNN from the H1 without treating it as the title", () => {
    expect(parseLearningRecord(CANONICAL).parsed.title).not.toMatch(/^0007/u);
  });

  it("stores an empty string when ## What Was Learned is missing, and does not throw", () => {
    // `learning_records.what_learned` is NOT NULL, and throwing here fails the
    // whole run — losing the record's other four sections, which are often the
    // useful ones. This is §7.4's degradation rule in one field.
    const result = parseLearningRecord("# 0009. Something\n\n## Next\n\nKeep going.\n");

    expect(result.parsed.whatLearned).toBe("");
    expect(result.parsed.next).toBe("Keep going.");
    expect(codes(result)).toContain("section_missing");
  });

  it("leaves the four optional sections null when absent", () => {
    const { parsed } = parseLearningRecord(
      "# 0009. X\n\n## What Was Learned\n\nA thing happened.\n",
    );

    expect(parsed).toMatchObject({
      evidence: null,
      keyInsight: null,
      struggles: null,
      next: null,
    });
  });

  describe("Date:", () => {
    it("reads a bare ISO date without resolving it", () => {
      // Returned as written on purpose. Resolving to an instant here would use the
      // server's zone; the caller resolves it in the user's, because a record
      // dated 2026-08-08 that lands on 2026-08-07 moves which weekly review it
      // belongs to.
      expect(parseLearningRecord(CANONICAL).parsed.date).toBe("2026-08-08");
    });

    it("refuses a prose date rather than guessing at its locale", () => {
      // "08/09/2026" is two different days depending on who wrote it, and a
      // best-effort parse resolves through the server's locale.
      const result = parseLearningRecord("# 0009. X\n\nDate: 8 August 2026\n");

      expect(result.parsed.date).toBeNull();
      expect(codes(result)).toContain("value_malformed");
    });

    it("warns when there is no date line at all", () => {
      const result = parseLearningRecord("# 0009. X\n\n## What Was Learned\n\nA thing.\n");

      expect(result.parsed.date).toBeNull();
      expect(codes(result)).toContain("section_missing");
    });
  });

  describe("supersession, which has no heading in the format", () => {
    it("infers it from a link on a line that says it supersedes", () => {
      // LEARNING-RECORD-FORMAT.md describes supersession only as prose. A parser
      // that looks for `## Supersedes` finds nothing forever — and since records
      // are append-only, a superseded record keeps feeding the ZPD recommender an
      // insight the learner has since been taught out of.
      const { parsed } = parseLearningRecord(
        `# 0012. Correction\n\n## What Was Learned\n\n` +
          `This supersedes [0007-rls-basics.md](../learning-records/0007-rls-basics.md).\n`,
      );

      expect(parsed.supersedesSeq).toBe(7);
    });

    it("accepts the other words a model uses for it", () => {
      for (const verb of ["supersedes", "replaces", "corrects", "revises"]) {
        const { parsed } = parseLearningRecord(
          `# 0012. X\n\n## Key Insight\n\nThis ${verb} 0003-old-idea.md.\n`,
        );
        expect(parsed.supersedesSeq).toBe(3);
      }
    });

    it("stays null and silent when nothing supersedes anything", () => {
      // The overwhelmingly common case. It must not warn: a warning on every
      // ordinary record is a warning nobody reads.
      const result = parseLearningRecord(CANONICAL);

      expect(result.parsed.supersedesSeq).toBeNull();
      expect(result.warnings).toEqual([]);
    });

    it("ignores a plain backlink, which the format actively encourages", () => {
      // Records build on each other, so most of them link backwards. Treating
      // every backlink as a supersession would retire most of the ledger.
      const { parsed } = parseLearningRecord(
        `# 0012. X\n\n## What Was Learned\n\nBuilding on 0007-rls-basics.md, roles matter.\n`,
      );

      expect(parsed.supersedesSeq).toBeNull();
    });

    it("refuses to choose when one line names two records", () => {
      // A coin flip here quietly retires a record that was still true.
      const { parsed } = parseLearningRecord(
        `# 0012. X\n\n## What Was Learned\n\nSupersedes 0007-a.md and 0008-b.md.\n`,
      );

      expect(parsed.supersedesSeq).toBeNull();
    });
  });

  it("falls back to null title when there is no H1, so the caller can use the filename", () => {
    // `learning_records.title` is NOT NULL and the filename always has one.
    const result = parseLearningRecord("## What Was Learned\n\nA thing.\n");

    expect(result.parsed.title).toBeNull();
    expect(codes(result)).toContain("title_missing");
  });

  it("retains a section it has no column for", () => {
    const result = parseLearningRecord(
      "# 0009. X\n\n## What Was Learned\n\nA thing.\n\n## Open Questions\n\nWhy though.\n",
    );

    expect(result.unmapped).toEqual({ "Open Questions": "Why though." });
    expect(codes(result)).toContain("section_unknown");
  });

  it("parses an empty file without throwing", () => {
    expect(() => parseLearningRecord("")).not.toThrow();
    expect(parseLearningRecord("").parsed.whatLearned).toBe("");
  });
});
