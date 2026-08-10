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

## Sources

- [AWS IAM User Guide](https://docs.aws.amazon.com/iam/) — the primary reference

## History

- 2026-08-09: created
`;

function codes(warnings: readonly { code: WarningCode }[]): WarningCode[] {
  return warnings.map((w) => w.code);
}

describe("parseCurriculum", () => {
  it("reads the subject and the tracks", () => {
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
  });

  it("treats the em dash as no prerequisites rather than as one", () => {
    const { parsed } = parseCurriculum(FULL);
    expect(parsed.tracks[0]!.prerequisites).toEqual([]);
    expect(parsed.tracks[1]!.prerequisites).toEqual([]);
  });

  it("retains Sources and History without indexing them", () => {
    // `## Sources` belongs to RESOURCES.md, which stays a workspace file the
    // agent grounds itself in (FR-K4). Indexing this section would write the same
    // facts through a second path.
    const { parsed, unmapped, warnings } = parseCurriculum(FULL);

    expect(unmapped["Sources"]).toContain("AWS IAM User Guide");
    expect(unmapped["History"]).toContain("2026-08-09");
    expect(codes(warnings)).toContain("section_unknown");
    expect(JSON.stringify(parsed)).not.toContain("docs.aws.amazon.com");
  });

  it("retains a legacy Skills section as an unknown section", () => {
    // Curricula written before the v0.2 refocus carried a `## Skills` table.
    // Nothing indexes it now; the content is kept rather than dropped.
    const { parsed, unmapped, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | a    | A     |

## Skills

| Track | Skill slug | Skill |
| ----- | ---------- | ----- |
| a     | s          | S     |
`);

    expect(unmapped["Skills"]).toContain("Skill slug");
    expect(codes(warnings)).toContain("section_unknown");
    expect(JSON.stringify(parsed)).not.toContain("skillSlug");
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
    expect(parsed).toEqual({ subject: null, tracks: [], lessons: [] });
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

  it("retains a section this format knows nothing about, and does not read it as a module", () => {
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

/**
 * The module tables (FR-K2). A planned lesson is a row with no file, and it is
 * what gives a module an honest denominator — so every test here is about the
 * plan surviving a file the agent wrote carelessly, and about the two edges it
 * must refuse rather than store.
 */
const PLANNED = `# Curriculum

## Tracks

| Order | Slug           | Track              | Prerequisites |
| ----- | -------------- | ------------------ | ------------- |
| 1     | iam-basics     | IAM fundamentals   | —             |
| 2     | iam-authoring  | Writing IAM policy | iam-basics    |

## Module: iam-basics

| Slug              | Lesson                  | Intent                        | Difficulty | Depth     | Depends on     |
| ----------------- | ----------------------- | ----------------------------- | ---------- | --------- | -------------- |
| policy-anatomy    | Anatomy of a policy     | Name every element out loud   | 1          | overview  | —              |
| policy-evaluation | How a request is judged | Walk a request through it     | 3          | working   | policy-anatomy |

## Module: iam-authoring

| Slug            | Lesson                  | Intent                   | Difficulty | Depth     | Depends on        |
| --------------- | ----------------------- | ------------------------ | ---------- | --------- | ----------------- |
| least-privilege | Writing least privilege | Grant exactly what fits  | 4          | deep dive | policy-evaluation |
`;

describe("planned lessons", () => {
  it("reads a module table into planned lessons", () => {
    const { parsed, warnings } = parseCurriculum(PLANNED);

    expect(warnings).toEqual([]);
    expect(parsed.lessons.map((l) => l.slug)).toEqual([
      "policy-anatomy",
      "policy-evaluation",
      "least-privilege",
    ]);
    expect(parsed.lessons[1]).toEqual({
      slug: "policy-evaluation",
      title: "How a request is judged",
      intent: "Walk a request through it",
      difficulty: 3,
      depth: "working",
      trackSlug: "iam-basics",
      position: 2,
      dependsOn: ["policy-anatomy"],
    });
  });

  it("lets a lesson depend on one in an earlier module", () => {
    const { parsed } = parseCurriculum(PLANNED);
    expect(parsed.lessons[2]).toMatchObject({
      trackSlug: "iam-authoring",
      depth: "deep_dive",
      dependsOn: ["policy-evaluation"],
    });
  });

  it("does not report a module section as an unindexed one", () => {
    const { unmapped } = parseCurriculum(PLANNED);
    expect(unmapped).toEqual({});
  });

  it("drops an edge into a later module rather than locking a lesson forever", () => {
    // Forwards it would lock `policy-anatomy` behind a module the plan puts after
    // it, so the lesson would never unblock and the first module would never
    // start (FR-K2, FR-K7).
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug          | Track  | Prerequisites |
| ----- | ------------- | ------ | ------------- |
| 1     | iam-basics    | Basics | —             |
| 2     | iam-authoring | Author | iam-basics    |

## Module: iam-basics

| Slug           | Lesson  | Depends on      |
| -------------- | ------- | --------------- |
| policy-anatomy | Anatomy | least-privilege |

## Module: iam-authoring

| Slug            | Lesson          |
| --------------- | --------------- |
| least-privilege | Least privilege |
`);

    expect(parsed.lessons[0]!.dependsOn).toEqual([]);
    expect(warnings).toContainEqual({
      code: "value_malformed",
      args: {
        field: "depends on",
        reason: "forward_module_edge",
        value: "least-privilege",
        lesson: "policy-anatomy",
      },
    });
  });

  it("orders modules by prerequisite, not by the Order column", () => {
    // The tracks table numbers `late` first and then says it requires `early`.
    // Believing the number would make the honest edge look like a forward one.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug  | Track | Prerequisites |
| ----- | ----- | ----- | ------------- |
| 1     | late  | Late  | early         |
| 2     | early | Early | —             |

## Module: late

| Slug        | Lesson | Depends on |
| ----------- | ------ | ---------- |
| second-half | Second | first-half |

## Module: early

| Slug       | Lesson |
| ---------- | ------ |
| first-half | First  |
`);

    expect(codes(warnings)).not.toContain("value_malformed");
    expect(parsed.lessons.find((l) => l.slug === "second-half")!.dependsOn).toEqual(["first-half"]);
  });

  it("breaks a cycle between two lessons in one module", () => {
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | t    | T     |

## Module: t

| Slug | Lesson | Depends on |
| ---- | ------ | ---------- |
| a    | A      | b          |
| b    | B      | a          |
`);

    expect(codes(warnings)).toContain("edge_cycle");
    const edges = parsed.lessons.flatMap((l) => l.dependsOn.map((p) => `${l.slug}<-${p}`));
    expect(edges).toEqual(["a<-b"]);
  });

  it("refuses a lesson that is its own prerequisite", () => {
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | t    | T     |

## Module: t

| Slug | Lesson | Depends on |
| ---- | ------ | ---------- |
| a    | A      | a          |
`);

    expect(parsed.lessons[0]!.dependsOn).toEqual([]);
    expect(codes(warnings)).toContain("edge_cycle");
  });

  it("resolves a dependency written as a title rather than a slug", () => {
    const { parsed } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | t    | T     |

## Module: t

| Slug | Lesson              | Depends on          |
| ---- | ------------------- | ------------------- |
| a    | Anatomy of a policy | —                   |
| b    | Evaluation          | Anatomy of a policy |
`);

    expect(parsed.lessons[1]!.dependsOn).toEqual(["a"]);
  });

  it("drops a dependency on a lesson the plan does not contain", () => {
    // `lesson_edges.prereq_id` is a foreign key and there is no row to point it
    // at. Named in the warning so the gap is visible on the run result.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | t    | T     |

## Module: t

| Slug | Lesson | Depends on |
| ---- | ------ | ---------- |
| a    | A      | ghost      |
`);

    expect(parsed.lessons[0]!.dependsOn).toEqual([]);
    expect(codes(warnings)).toContain("value_unknown");
  });

  it("finds a module section headed by the track's name", () => {
    const { parsed } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug       | Track            |
| ----- | ---------- | ---------------- |
| 1     | iam-basics | IAM fundamentals |

## Module: IAM fundamentals

| Slug | Lesson |
| ---- | ------ |
| a    | A      |
`);

    expect(parsed.lessons[0]!.trackSlug).toBe("iam-basics");
  });

  it("finds a module section headed by slug and name together", () => {
    const { parsed, unmapped } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug       | Track            |
| ----- | ---------- | ---------------- |
| 1     | iam-basics | IAM fundamentals |

## iam-basics — IAM fundamentals

| Slug | Lesson |
| ---- | ------ |
| a    | A      |
`);

    expect(parsed.lessons[0]!.trackSlug).toBe("iam-basics");
    expect(unmapped).toEqual({});
  });

  it("keeps a module section that names no track, and says which", () => {
    const { parsed, unmapped, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | t    | T     |

## Module: renamed-away

| Slug | Lesson |
| ---- | ------ |
| a    | A      |
`);

    expect(parsed.lessons).toEqual([]);
    expect(unmapped["Module: renamed-away"]).toContain("| a    | A      |");
    expect(warnings).toContainEqual({
      code: "value_unknown",
      args: { field: "Module", value: "Module: renamed-away" },
    });
  });

  it("keeps the first of two sections claiming one module", () => {
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug       | Track            |
| ----- | ---------- | ---------------- |
| 1     | iam-basics | IAM fundamentals |

## Module: iam-basics

| Slug | Lesson |
| ---- | ------ |
| a    | A      |

## Module: IAM fundamentals

| Slug | Lesson |
| ---- | ------ |
| b    | B      |
`);

    expect(parsed.lessons.map((l) => l.slug)).toEqual(["a"]);
    expect(warnings).toContainEqual({
      code: "value_duplicated",
      args: { field: "Module", value: "iam-basics" },
    });
  });

  it("keeps the first of two lessons sharing a slug across modules", () => {
    // `(mission_id, slug)` is what a written lesson claims its plan entry by, so
    // two rows with one slug are two modules fighting over one row.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | one  | One   |
| 2     | two  | Two   |

## Module: one

| Slug   | Lesson |
| ------ | ------ |
| shared | First  |

## Module: two

| Slug   | Lesson |
| ------ | ------ |
| shared | Second |
`);

    expect(parsed.lessons).toHaveLength(1);
    expect(parsed.lessons[0]).toMatchObject({ title: "First", trackSlug: "one" });
    expect(codes(warnings)).toContain("value_duplicated");
  });

  it("leaves difficulty null rather than clamping one out of range", () => {
    // A 7 clamped to 5 is a number nobody wrote presented as one somebody did.
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | t    | T     |

## Module: t

| Slug | Lesson | Difficulty | Depth        |
| ---- | ------ | ---------- | ------------ |
| a    | A      | 7          | intermediate |
| b    | B      | —          | —            |
| c    | C      | 2          | Deep-Dive    |
`);

    expect(parsed.lessons.map((l) => l.difficulty)).toEqual([null, null, 2]);
    expect(parsed.lessons.map((l) => l.depth)).toEqual([null, null, "deep_dive"]);

    // The unreadable pair warns; the em dash is a blank cell and does not.
    expect(codes(warnings)).toEqual(["value_malformed", "value_unknown"]);
  });

  it("derives a lesson slug from its title, and says so", () => {
    const { parsed, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | t    | T     |

## Module: t

| Lesson              | Intent |
| ------------------- | ------ |
| Anatomy of a policy | Read   |
`);

    expect(parsed.lessons[0]).toMatchObject({
      slug: "anatomy-of-a-policy",
      title: "Anatomy of a policy",
    });
    expect(codes(warnings)).toContain("value_coerced");
  });

  it("plans nothing for a module whose table is prose, and keeps the prose", () => {
    const { parsed, unmapped, warnings } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | t    | T     |

## Module: t

I ran out of turns before planning this one.
`);

    expect(parsed.lessons).toEqual([]);
    expect(unmapped["Module: t"]).toBe("I ran out of turns before planning this one.");
    expect(warnings).toContainEqual({
      code: "value_malformed",
      args: { field: "Module: t", reason: "not_a_table" },
    });
  });

  it("indexes the tracks even when no module has been planned yet", () => {
    // A half-written curriculum is the normal state of one the run cut short.
    const { parsed, warnings } = parseCurriculum(FULL);

    expect(parsed.tracks).toHaveLength(3);
    expect(parsed.lessons).toEqual([]);
    expect(codes(warnings)).not.toContain("value_malformed");
  });

  it("retains a column the module table invented", () => {
    const { parsed, unmapped } = parseCurriculum(`# Curriculum

## Tracks

| Order | Slug | Track |
| ----- | ---- | ----- |
| 1     | t    | T     |

## Module: t

| Slug | Lesson | Estimated minutes |
| ---- | ------ | ----------------- |
| a    | A      | 45                |
`);

    expect(parsed.lessons).toHaveLength(1);
    expect(unmapped["Module: t/a/Estimated minutes"]).toBe("45");
  });
});
