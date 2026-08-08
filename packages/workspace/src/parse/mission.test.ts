import { describe, expect, it } from "vitest";

import { parseMission } from "./mission.js";
import type { WarningCode } from "./result.js";

const codes = (result: ReturnType<typeof parseMission>): WarningCode[] =>
  result.warnings.map((w) => w.code);

/** The format doc's own example, filled in. */
const FILLED = `# Mission

## Topic

Postgres row-level security, enough to review a migration.

## Why

I write policies for a single-user app and want to stop trusting that they work.

## Success Looks Like

I can read a policy and say which role it binds to.

## Constraints

30 minutes a day. Text over video.

## Current Level

I write SQL comfortably. I have never debugged a policy that failed open.

## History

- 2026-08-01: Created after a policy silently returned every user's rows.
- 2026-08-05: Narrowed from "Postgres" to RLS specifically.
`;

/** The format doc's example verbatim, which is what an agent writes first. */
const UNFILLED = `# Mission

## Topic

<what the user is learning, in one line>

## Why

<the real-world reason the user wants to learn this, in their own words>

## History

- YYYY-MM-DD: <mission created / revised, and why>
`;

describe("parseMission", () => {
  it("takes the topic from the body of ## Topic, never from the H1", () => {
    // The single most consequential mistake available here. `# Mission` is a
    // literal constant in MISSION-FORMAT.md — every workspace's H1 is identical —
    // so a parser that reads it as the title gives every mission in the system
    // the topic "Mission", and looks like it worked.
    const { parsed } = parseMission(FILLED);

    expect(parsed.fields.topic).toBe("Postgres row-level security, enough to review a migration.");
    expect(parsed.fields.topic).not.toBe("Mission");
  });

  it("reads all five content fields", () => {
    const { parsed } = parseMission(FILLED);

    expect(parsed.fields.why).toContain("single-user app");
    expect(parsed.fields.successLooksLike).toContain("which role it binds to");
    expect(parsed.fields.constraints).toContain("30 minutes a day");
    expect(parsed.fields.currentLevel).toContain("failed open");
  });

  it("treats an unfilled template placeholder as empty, not as the mission", () => {
    // The agent writes the shell before filling it. A parser that treats any
    // non-empty text as content stores "<what the user is learning, in one line>"
    // as the user's actual mission topic and teaches from it.
    const result = parseMission(UNFILLED);

    expect(result.parsed.fields.topic).toBeNull();
    expect(result.parsed.fields.why).toBeNull();
    expect(codes(result)).toContain("section_placeholder");
  });

  it("returns a null topic rather than throwing when ## Topic is missing", () => {
    // §7.4: degrade to "stored, partially indexed", never "run failed". A mission
    // file with no topic still has four other sections worth having.
    const result = parseMission("# Mission\n\n## Why\n\nBecause.\n");

    expect(result.parsed.fields.topic).toBeNull();
    expect(result.parsed.fields.why).toBe("Because.");
    expect(codes(result)).toContain("section_missing");
  });

  it("rejects a topic too short for packages/core to accept", () => {
    // `MissionFieldsSchema` requires three characters. Catching it here makes it
    // a warning on the run; letting it through makes it a 422 nobody triggered.
    const result = parseMission("# Mission\n\n## Topic\n\nGo\n");

    expect(result.parsed.fields.topic).toBeNull();
    expect(codes(result)).toContain("value_malformed");
  });

  it("truncates an over-long topic rather than losing the file", () => {
    const result = parseMission(`# Mission\n\n## Topic\n\n${"x".repeat(300)}\n`);

    expect(result.parsed.fields.topic).toHaveLength(200);
    expect(codes(result)).toContain("value_coerced");
  });

  it("matches headings regardless of depth, case, spacing and a trailing colon", () => {
    // Binding by document order would make any of these shift every later field
    // by one. The agent is not bound by the format doc's exact rendering.
    const { parsed } = parseMission(
      `# Mission\n\n### topic:\n\nRust ownership\n\n##  Success   Looks Like\n\nI ship a crate\n`,
    );

    expect(parsed.fields.topic).toBe("Rust ownership");
    expect(parsed.fields.successLooksLike).toBe("I ship a crate");
  });

  it("reads Setext headings, so a section is not absorbed into the one above it", () => {
    const { parsed } = parseMission(
      "# Mission\n\nTopic\n-----\n\nRust ownership\n\nWhy\n---\n\nTo ship a crate\n",
    );

    expect(parsed.fields.topic).toBe("Rust ownership");
    expect(parsed.fields.why).toBe("To ship a crate");
  });

  it("keeps the first of a repeated heading and says so", () => {
    // Concatenating would invent a section the file does not contain; taking the
    // last discards content with no trace.
    const result = parseMission("# Mission\n\n## Topic\n\nfirst\n\n## Topic\n\nsecond\n");

    expect(result.parsed.fields.topic).toBe("first");
    expect(codes(result)).toContain("heading_duplicated");
  });

  it("retains a section it has no column for instead of dropping it", () => {
    // The file is canonical (non-negotiable 5). "We have no table for this" is a
    // fact about Mindforge, and a lossy round-trip is how a workspace stops being
    // the source of truth.
    const result = parseMission("# Mission\n\n## Topic\n\nA\n\n## Anti-Goals\n\nNot Haskell.\n");

    expect(result.unmapped).toEqual({ "Anti-Goals": "Not Haskell." });
    expect(codes(result)).toContain("section_unknown");
  });

  describe("## History", () => {
    it("reads each bullet as a dated revision", () => {
      const { parsed } = parseMission(FILLED);

      expect(parsed.history).toEqual([
        {
          date: "2026-08-01",
          reason: "Created after a policy silently returned every user's rows.",
        },
        { date: "2026-08-05", reason: 'Narrowed from "Postgres" to RLS specifically.' },
      ]);
    });

    it("deduplicates, because the whole section is re-parsed on every run", () => {
      // `mission_revisions` has no unique constraint, and the file does not
      // shrink. Three runs against an unchanged mission would otherwise triple
      // the ledger — and the product reads mission drift as a signal, so a ledger
      // that grows on its own is a lie about how often the mission changed.
      const { parsed } = parseMission(
        "# Mission\n\n## History\n\n- 2026-08-01: Created.\n- 2026-08-01: Created.\n",
      );

      expect(parsed.history).toHaveLength(1);
    });

    it("skips the placeholder bullet in an unfilled template", () => {
      expect(parseMission(UNFILLED).parsed.history).toEqual([]);
    });

    it("warns rather than inventing a date for an undated bullet", () => {
      // A guessed date puts a revision in the wrong week, which is worse than not
      // recording it: the weekly review would report drift that did not happen.
      const result = parseMission("# Mission\n\n## History\n\n- Changed the mission.\n");

      expect(result.parsed.history).toEqual([]);
      expect(codes(result)).toContain("value_malformed");
    });

    it("accepts the separators an agent writes instead of a colon", () => {
      const { parsed } = parseMission(
        "# Mission\n\n## History\n\n- 2026-08-01 — Created.\n- 2026-08-02 - Revised.\n",
      );

      expect(parsed.history.map((entry) => entry.reason)).toEqual(["Created.", "Revised."]);
    });
  });

  it("parses a file with no headings at all without throwing", () => {
    const result = parseMission("just some prose\n");

    expect(result.parsed.fields.topic).toBeNull();
    expect(result.parsed.history).toEqual([]);
  });

  it("parses an empty file without throwing", () => {
    expect(() => parseMission("")).not.toThrow();
    expect(parseMission("").parsed.fields.topic).toBeNull();
  });
});
