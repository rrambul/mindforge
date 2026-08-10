import { describe, expect, it } from "vitest";

import { parseCurriculum } from "./curriculum.js";
import type { WarningCode } from "./result.js";

/**
 * `CURRICULUM.md` is written by a model and rewritten wholesale on every
 * revision, so every test here is about what happens when it is written *badly*.
 * A file this parser refuses is a mission with no subtopics, which is the failure
 * the §7.4 degradation rule exists to prevent.
 */

const FULL = `# Curriculum

## Subject

Amazon Web Services, for someone who owns a production VPC

## Tracks

| Order | Slug           | Track              | Outcome                                 | Prerequisites |
| ----- | -------------- | ------------------ | --------------------------------------- | ------------- |
| 1     | iam-basics     | IAM fundamentals   | Read a policy and say what it permits   | —             |
| 2     | vpc-networking | VPC networking     | Trace a packet through your own VPC     | —             |
| 3     | iam-authoring  | Writing IAM policy | Write a least-privilege policy          | iam-basics    |

## Skills

| Track          | Skill slug          | Skill                                    |
| -------------- | ------------------- | ---------------------------------------- |
| iam-basics     | iam-read-policy     | Read an IAM policy and predict its effect |
| iam-basics     | iam-principal-model | Explain users, roles and assume-role      |
| iam-authoring  | iam-least-privilege | Write a least-privilege policy            |

## Sources

- [AWS IAM User Guide](https://docs.aws.amazon.com/iam/) — the primary reference

## History

- 2026-08-09: created
`;

function codes(warnings: readonly { code: WarningCode }[]): WarningCode[] {
  return warnings.map((w) => w.code);
}

describe("parseCurriculum", () => {
  it("reads the subject, the tracks and their skills", () => {
    const { parsed } = parseCurriculum(FULL);

    expect(parsed.subject).toBe("Amazon Web Services, for someone who owns a production VPC");
    expect(parsed.tracks.map((t) => t.slug)).toEqual([
      "iam-basics",
      "vpc-networking",
      "iam-authoring",
    ]);
    expect(parsed.tracks[2]).toMatchObject({
      slug: "iam-authoring",
      name: "Writing IAM policy",
      outcome: "Write a least-privilege policy",
      position: 3,
      prerequisites: ["iam-basics"],
    });
    expect(parsed.skills).toHaveLength(3);
    expect(parsed.skills[0]).toEqual({
      trackSlug: "iam-basics",
      skillSlug: "iam-read-policy",
      name: "Read an IAM policy and predict its effect",
    });
  });

  it("treats the em dash as no prerequisites rather than as one", () => {
    const { parsed } = parseCurriculum(FULL);
    expect(parsed.tracks[0]!.prerequisites).toEqual([]);
    expect(parsed.tracks[1]!.prerequisites).toEqual([]);
  });

  it("retains Sources and History without indexing them", () => {
    // `## Sources` belongs to RESOURCES.md, which owns the library and has the
    // type and trust columns this section does not. Writing resources through a
    // second path is the doubling problem with the safeguards removed.
    const { parsed, unmapped, warnings } = parseCurriculum(FULL);

    expect(unmapped["Sources"]).toContain("AWS IAM User Guide");
    expect(unmapped["History"]).toContain("2026-08-09");
    expect(codes(warnings)).toContain("section_unknown");
    expect(JSON.stringify(parsed)).not.toContain("docs.aws.amazon.com");
  });

  it("binds columns by name, so a reordered or added column changes nothing", () => {
    const reordered = `# Curriculum

## Tracks

| Track            | Status  | Prerequisites | Slug       | Order |
| ---------------- | ------- | ------------- | ---------- | ----- |
| IAM fundamentals | drafted | —             | iam-basics | 1     |
`;
    const { parsed, unmapped } = parseCurriculum(reordered);

    expect(parsed.tracks[0]).toMatchObject({ slug: "iam-basics", name: "IAM fundamentals" });
    // The unknown column is kept rather than dropped: "Mindforge has nowhere to
    // put this" is a fact about Mindforge, not about the file.
    expect(unmapped["Tracks/iam-basics/Status"]).toBe("drafted");
  });

  it("derives a missing slug from the name, and says that it had to", () => {
    // Losing the track would be worse. But a derived slug moves when the track is
    // renamed, and a moved slug orphans every lesson pointing at it — so the
    // warning is the whole value of the branch.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Track            | Outcome |
| ----- | ---------------- | ------- |
| 1     | IAM Fundamentals | Read it |
`);

    expect(parsed.tracks[0]!.slug).toBe("iam-fundamentals");
    expect(codes(warnings)).toContain("value_coerced");
  });

  it("keeps the first of two rows claiming one slug", () => {
    // `(mission_id, slug)` is unique. The alternative to first-wins is a run that
    // fails on a file it could mostly read.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug  | Track   |
| ----- | ----- | ------- |
| 1     | iam   | First   |
| 2     | iam   | Second  |
`);

    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]!.name).toBe("First");
    expect(codes(warnings)).toContain("value_duplicated");
  });

  it("falls back to row order when Order is missing or unreadable", () => {
    // `position` is NOT NULL, and the agent wrote the table top to bottom — the
    // sequence it typed is the recommendation even when the numbers are not.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug  | Track  |
| ----- | ----- | ------ |
| first | one   | One    |
|       | two   | Two    |
`);

    expect(parsed.tracks.map((t) => t.position)).toEqual([1, 2]);
    expect(codes(warnings)).toContain("value_coerced");
  });

  it("resolves a prerequisite named by title rather than by slug", () => {
    const { parsed } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug       | Track            | Prerequisites    |
| ----- | ---------- | ---------------- | ---------------- |
| 1     | iam-basics | IAM Fundamentals | —                |
| 2     | iam-deep   | IAM In Anger     | IAM Fundamentals |
`);

    expect(parsed.tracks[1]!.prerequisites).toEqual(["iam-basics"]);
  });

  it("resolves a prerequisite that appears later in the table", () => {
    // The order column is a reading recommendation, not a topological sort, so a
    // forward reference is legal. A single-pass resolver would drop it.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug  | Track | Prerequisites |
| ----- | ----- | ----- | ------------- |
| 1     | later | Later | earlier       |
| 2     | earlier | Earlier | —          |
`);

    expect(parsed.tracks[0]!.prerequisites).toEqual(["earlier"]);
    expect(codes(warnings)).not.toContain("value_unknown");
  });

  it("splits several prerequisites out of one cell", () => {
    const { parsed } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track | Prerequisites |
| ----- | ---- | ----- | ------------- |
| 1     | a    | A     | —             |
| 2     | b    | B     | —             |
| 3     | c    | C     | a, b          |
| 4     | d    | D     | a and b       |
`);

    expect(parsed.tracks[2]!.prerequisites).toEqual(["a", "b"]);
    expect(parsed.tracks[3]!.prerequisites).toEqual(["a", "b"]);
  });

  it("drops a prerequisite naming a track that does not exist", () => {
    // `track_edges.prereq_id` is a foreign key with nothing to point at. Named in
    // the warning so the gap shows on the run result rather than vanishing.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track | Prerequisites |
| ----- | ---- | ----- | ------------- |
| 1     | a    | A     | imaginary     |
`);

    expect(parsed.tracks[0]!.prerequisites).toEqual([]);
    expect(codes(warnings)).toContain("value_unknown");
  });

  it("refuses a track that is its own prerequisite", () => {
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track | Prerequisites |
| ----- | ---- | ----- | ------------- |
| 1     | a    | A     | a             |
`);

    expect(parsed.tracks[0]!.prerequisites).toEqual([]);
    expect(codes(warnings)).toContain("edge_cycle");
  });

  it("breaks a two-hop cycle and keeps both tracks", () => {
    // Postgres cannot catch this: `track_edges` refuses only the self-edge, and a
    // DAG is not expressible as a constraint. Nothing downstream would notice
    // until a topological sort hung on it.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track | Prerequisites |
| ----- | ---- | ----- | ------------- |
| 1     | a    | A     | b             |
| 2     | b    | B     | a             |
`);

    expect(parsed.tracks).toHaveLength(2);
    expect(codes(warnings)).toContain("edge_cycle");

    // Exactly one direction survives, and the file's own order decides which —
    // the only non-arbitrary tie-break available.
    const edges = parsed.tracks.flatMap((t) => t.prerequisites.map((p) => `${t.slug}<-${p}`));
    expect(edges).toEqual(["a<-b"]);
  });

  it("breaks a three-hop cycle too", () => {
    const { parsed } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track | Prerequisites |
| ----- | ---- | ----- | ------------- |
| 1     | a    | A     | c             |
| 2     | b    | B     | a             |
| 3     | c    | C     | b             |
`);

    const edges = parsed.tracks.flatMap((t) => t.prerequisites.map((p) => `${t.slug}<-${p}`));
    expect(edges).toHaveLength(2);
  });

  it("drops a skill whose track does not exist", () => {
    // `track_skills` is keyed on the pair, so a skill belonging to no track has
    // nowhere to go. Attaching it to an arbitrary track would be a guess written
    // into the graph the product scores from.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | a    | A     |

## Skills

| Track     | Skill slug | Skill      |
| --------- | ---------- | ---------- |
| imaginary | ghost      | A ghost    |
`);

    expect(parsed.skills).toEqual([]);
    expect(codes(warnings)).toContain("value_unknown");
  });

  it("keeps one row when a skill is listed twice under the same track", () => {
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | a    | A     |

## Skills

| Track | Skill slug | Skill |
| ----- | ---------- | ----- |
| a     | s          | S     |
| a     | s          | S again |
`);

    expect(parsed.skills).toHaveLength(1);
    expect(codes(warnings)).toContain("value_duplicated");
  });

  it("lets one skill belong to two tracks", () => {
    // The primary key is the pair, and reusing a skill across tracks is the point:
    // `skills.slug` is unique per user, so the learner learns a thing once.
    const { parsed } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | a    | A     |
| 2     | b    | B     |

## Skills

| Track | Skill slug | Skill |
| ----- | ---------- | ----- |
| a     | shared     | Shared |
| b     | shared     | Shared |
`);

    expect(parsed.skills).toHaveLength(2);
  });

  it("returns nothing and warns when Tracks is missing entirely", () => {
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Subject

Rust
`);

    expect(parsed.tracks).toEqual([]);
    expect(parsed.subject).toBe("Rust");
    expect(codes(warnings)).toContain("section_missing");
  });

  it("does not read a header row as data when the delimiter is missing", () => {
    // Without the delimiter check the header becomes a track called "Slug".
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| 1     | a    | A     |
`);

    expect(parsed.tracks).toEqual([]);
    expect(codes(warnings)).toContain("value_malformed");
  });

  it("refuses a tracks table with neither a slug nor a name column", () => {
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Outcome |
| ----- | ------- |
| 1     | Do it   |
`);

    expect(parsed.tracks).toEqual([]);
    expect(codes(warnings)).toContain("value_malformed");
  });

  it("leaves the subject null rather than inventing one", () => {
    // The section is present but still holds the format doc's placeholder, which
    // `parseDocument` resolves to empty. A subject defaulted to the mission topic
    // would be Mindforge answering its own question.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Subject

<the subject being mastered, in one line>

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | a    | A     |
`);

    expect(parsed.subject).toBeNull();
    expect(codes(warnings)).toContain("section_placeholder");
  });

  it("survives an empty file", () => {
    const { parsed, warnings } = parseCurriculum("");
    expect(parsed).toEqual({ subject: null, tracks: [], skills: [] });
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("normalises an accented slug the way lesson filenames are normalised", () => {
    // Lessons are written in the learner's content language (FR-L3), and the meta
    // tag on the other side of this join is slugified the same way.
    const { parsed } = parseCurriculum(`# Curriculum

## Tracks

| Order | Track              |
| ----- | ------------------ |
| 1     | Café com Leite     |
`);

    expect(parsed.tracks[0]!.slug).toBe("cafe-com-leite");
    expect(parsed.tracks[0]!.name).toBe("Café com Leite");
  });
});

describe("rows that cannot become anything", () => {
  it("drops a track whose name survives no character of slugification", () => {
    // `tracks.slug` is the identity a lesson points at, and there is nothing
    // honest to derive from "!!!". The row is dropped and said so, rather than
    // becoming a track called "Untitled" that a later run silently merges with
    // the next one.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Track |
| ----- | ----- |
| 1     | !!!   |
| 2     | Real  |
`);

    expect(parsed.tracks.map((t) => t.slug)).toEqual(["real"]);
    expect(codes(warnings)).toContain("value_malformed");
  });

  it("names a track from its slug when the table has no name column", () => {
    // `tracks.name` is NOT NULL and the slug is always there by this point.
    const { parsed } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug       |
| ----- | ---------- |
| 1     | iam-basics |
`);

    expect(parsed.tracks[0]).toMatchObject({ slug: "iam-basics", name: "Iam Basics" });
  });

  it("names a skill from its slug when the table has no name column", () => {
    const { parsed } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug |
| ----- | ---- |
| 1     | a    |

## Skills

| Track | Skill slug      |
| ----- | --------------- |
| a     | iam-read-policy |
`);

    expect(parsed.skills[0]).toMatchObject({
      skillSlug: "iam-read-policy",
      name: "Iam Read Policy",
    });
  });

  it("drops a skill whose slug and name both slugify to nothing", () => {
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug |
| ----- | ---- |
| 1     | a    |

## Skills

| Track | Skill |
| ----- | ----- |
| a     | ???   |
`);

    expect(parsed.skills).toEqual([]);
    expect(codes(warnings)).toContain("value_malformed");
  });

  it("does not read a skills header row as data when the delimiter is missing", () => {
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug |
| ----- | ---- |
| 1     | a    |

## Skills

| Track | Skill |
| a     | S     |
`);

    expect(parsed.skills).toEqual([]);
    expect(codes(warnings)).toContain("value_malformed");
  });

  it("refuses a skills table with neither a name nor a slug column", () => {
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug |
| ----- | ---- |
| 1     | a    |

## Skills

| Track | Notes |
| ----- | ----- |
| a     | hmm   |
`);

    expect(parsed.skills).toEqual([]);
    expect(codes(warnings)).toContain("value_malformed");
  });

  it("collapses a prerequisite listed twice in one cell", () => {
    // `track_edges` is keyed on the pair, so the file is describing one edge.
    const { parsed } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track | Prerequisites |
| ----- | ---- | ----- | ------------- |
| 1     | a    | A     | —             |
| 2     | b    | B     | a, a          |
`);

    expect(parsed.tracks[1]!.prerequisites).toEqual(["a"]);
  });

  it("retains a section this format knows nothing about", () => {
    const { unmapped, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug |
| ----- | ---- |
| 1     | a    |

## Budget

Two evenings a week.
`);

    expect(unmapped["Budget"]).toBe("Two evenings a week.");
    expect(codes(warnings)).toContain("section_unknown");
  });
});
