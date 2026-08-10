import { FixedClock } from "@mindforge/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateMission } from "../../missions/application/update-mission.js";
import type {
  IndexedLesson,
  IndexedPlannedLesson,
  IndexedRecord,
  IndexedReferenceDoc,
  IndexedTrack,
  WorkspaceIndexRepository,
} from "./index.port.js";
import { ReindexWorkspace } from "./reindex-workspace.js";

/**
 * Which files become rows, and which do not.
 *
 * The integration suite proves the writes land and survive a second run. This
 * proves the decisions in front of them, which are the ones that quietly drop
 * content: an unnumbered lesson, a conflict copy, two files claiming one
 * sequence, a mission file the parser could not read.
 */

const NOW = new Date("2026-08-08T12:00:00.000Z");
const USER = "user-1";
const MISSION = "mission-1";

const encoder = new TextEncoder();
const files = (entries: Record<string, string>): ReadonlyMap<string, Uint8Array> =>
  new Map(Object.entries(entries).map(([path, text]) => [path, encoder.encode(text)]));

const LESSON = "<title>Closures</title><body><p>x</p></body>";

/** Tracks and no module tables — a curriculum the run stopped halfway through. */
const CURRICULUM_ONLY = `# Curriculum

## Tracks

| Order | Slug       | Track            | Prerequisites |
| ----- | ---------- | ---------------- | ------------- |
| 1     | iam-basics | IAM fundamentals | —             |
| 2     | iam-deep   | IAM in anger     | iam-basics    |
`;

function harness() {
  const saved = {
    lessons: [] as IndexedLesson[],
    docs: [] as IndexedReferenceDoc[],
    records: [] as IndexedRecord[],
    forgotten: [] as string[],
    tracks: [] as IndexedTrack[],
    planned: [] as IndexedPlannedLesson[],
  };

  /** Track slugs the mission already has, for the run that writes no curriculum. */
  const existingTracks = new Map<string, string>();

  const index: WorkspaceIndexRepository = {
    saveTracks: (_u, _m, tracks) => {
      saved.tracks.push(...tracks);
      for (const track of tracks) existingTracks.set(track.slug, `track-${track.slug}`);
      return Promise.resolve(new Map(existingTracks));
    },
    trackIdsBySlug: () => Promise.resolve(new Map(existingTracks)),
    savePlannedLessons: (_u, _m, lessons) => {
      saved.planned.push(...lessons);
      return Promise.resolve();
    },
    saveLessons: (_u, lessons) => {
      saved.lessons.push(...lessons);
      return Promise.resolve();
    },
    saveReferenceDocs: (_u, docs) => {
      saved.docs.push(...docs);
      return Promise.resolve();
    },
    saveRecords: (_u, records) => {
      saved.records.push(...records);
      return Promise.resolve();
    },
    forgetPaths: (_u, _m, paths) => {
      saved.forgotten.push(...paths);
      return Promise.resolve();
    },
  };

  const update = vi.fn<
    (userId: string, id: string, input: Record<string, unknown>) => Promise<never>
  >(() => Promise.resolve({} as never));
  const missions = { execute: update } as unknown as UpdateMission;

  return {
    saved,
    update,
    reindex: new ReindexWorkspace(index, new FixedClock(NOW), missions),
  };
}

let h: ReturnType<typeof harness>;

beforeEach(() => {
  h = harness();
});

function run(entries: Record<string, string>, timezone = "UTC") {
  return h.reindex.execute({
    userId: USER,
    missionId: MISSION,
    files: files(entries),
    deleted: [],
    timezone,
  });
}

describe("which files become rows", () => {
  it("indexes lessons, reference docs and records from their own directories", async () => {
    const result = await run({
      "lessons/0007-rls.html": LESSON,
      "reference/ownership.html": "<title>Ownership</title>",
      "learning-records/0007-x.md": "# 0007. X\n\n## What Was Learned\n\nA thing.\n",
    });

    expect(result).toMatchObject({ lessons: 1, referenceDocs: 1, records: 1 });
  });

  it("ignores files outside those directories", async () => {
    // `NOTES.md` is the agent's scratchpad and has no table. Indexing it would
    // invent a library entry nobody wrote.
    const result = await run({ "NOTES.md": "scratch", "MISSION.md": "# Mission" });

    expect(result).toMatchObject({ lessons: 0, referenceDocs: 0, records: 0 });
  });

  it("ignores a non-HTML file in lessons/", async () => {
    expect((await run({ "lessons/notes.txt": "x" })).lessons).toBe(0);
  });

  it("never indexes a retained conflict copy", async () => {
    // Its filename parses to a sequence that already exists, so it would collide
    // on `unique (mission_id, seq)` — and which of the two won would be arbitrary.
    const result = await run({
      "lessons/0007-rls.html": LESSON,
      "lessons/0007-rls.html.conflict-2026-08-08T12-00-00-000Z": LESSON,
    });

    expect(result.lessons).toBe(1);
    expect(h.saved.lessons[0]!.storagePath).toBe("lessons/0007-rls.html");
  });

  it("leaves an unnumbered lesson out of the index and says why", async () => {
    // `seq` is NOT NULL and unique per mission. The next free number is a fact
    // about the mission rather than about this file, so there is nothing honest
    // to invent — the file stays in Storage, out of the library, with a warning.
    const result = await run({ "lessons/closures.html": LESSON });

    expect(result.lessons).toBe(0);
    expect(result.warnings.map((w) => w.code)).toContain("filename_unnumbered");
  });

  it("keeps one lesson per sequence and reports the collision", async () => {
    // Two agents, a manual copy, a conflict file that slipped the name filter.
    // A unique violation must not fail a run that otherwise wrote a good lesson.
    const result = await run({
      "lessons/0007-a.html": LESSON,
      "lessons/0007-b.html": LESSON,
    });

    expect(result.lessons).toBe(1);
    expect(result.warnings.map((w) => w.code)).toContain("sequence_mismatch");
  });

  it("forwards deletions so a removed lesson leaves the library", async () => {
    await h.reindex.execute({
      userId: USER,
      missionId: MISSION,
      files: new Map(),
      deleted: ["lessons/0007-rls.html"],
      timezone: "UTC",
    });

    expect(h.saved.forgotten).toEqual(["lessons/0007-rls.html"]);
  });
});

describe("records", () => {
  it("falls back to the filename for a title, because the column is NOT NULL", async () => {
    await run({
      "learning-records/0009-policies-and-roles.md": "## What Was Learned\n\nA thing.\n",
    });

    expect(h.saved.records[0]!.title).toBe("Policies And Roles");
  });

  it("stores an empty string when the record has no What Was Learned", async () => {
    // NOT NULL, and throwing would fail the run and lose the record's other four
    // sections — §7.4's degradation rule in one field.
    await run({ "learning-records/0009-x.md": "# 0009. X\n\n## Next\n\nKeep going.\n" });

    expect(h.saved.records[0]).toMatchObject({ whatLearned: "", next: "Keep going." });
  });

  it("resolves the date in the learner's zone", async () => {
    // 2026-08-08 in São Paulo begins at 03:00 UTC. `new Date("2026-08-08")` is
    // 00:00 UTC, which is the 7th there — a different weekly review.
    await run(
      { "learning-records/0009-x.md": "# 0009. X\n\nDate: 2026-08-08\n" },
      "America/Sao_Paulo",
    );

    expect(h.saved.records[0]!.recordedAt.toISOString()).toBe("2026-08-08T03:00:00.000Z");
  });

  it("falls back to the run's own moment when the date is unreadable", async () => {
    await run({ "learning-records/0009-x.md": "# 0009. X\n\nDate: last Tuesday\n" });

    expect(h.saved.records[0]!.recordedAt).toEqual(NOW);
  });

  it("falls back to UTC for a timezone Intl rejects", async () => {
    // A profile with a bad zone is a data problem, not a reason to fail a run.
    await run({ "learning-records/0009-x.md": "# 0009. X\n\nDate: 2026-08-08\n" }, "Mars/Olympus");

    expect(h.saved.records[0]!.recordedAt.toISOString()).toBe("2026-08-08T00:00:00.000Z");
  });

  it("carries an inferred supersession", async () => {
    await run({
      "learning-records/0012-x.md":
        "# 0012. X\n\n## What Was Learned\n\nThis supersedes 0007-old.md.\n",
    });

    expect(h.saved.records[0]!.supersedesSeq).toBe(7);
  });
});

describe("MISSION.md", () => {
  it("routes the fields through the module that owns missions", async () => {
    // §2.1 decision 2. Writing `missions` here would be the rule violation the
    // boundary exists to prevent — and it is also what keeps `mission_revisions`
    // honest, since `applyEdit` decides whether anything drifted.
    await run({ "MISSION.md": "# Mission\n\n## Topic\n\nRow-level security\n" });

    expect(h.update).toHaveBeenCalledWith(
      USER,
      MISSION,
      expect.objectContaining({ topic: "Row-level security" }),
    );
  });

  it("does not touch the mission when the file has no readable topic", async () => {
    // The file may be mid-edit or still a template. Blanking a mission the
    // learner typed into the app because a parse came back empty is the data loss
    // non-negotiable 5 exists to prevent.
    await run({ "MISSION.md": "# Mission\n\n## Topic\n\n<what the user is learning>\n" });

    expect(h.update).not.toHaveBeenCalled();
  });

  it("does nothing at all when the workspace has no MISSION.md", async () => {
    await run({ "lessons/0007-rls.html": LESSON });

    expect(h.update).not.toHaveBeenCalled();
  });

  it("never writes mission_revisions from ## History", async () => {
    // The trap §7.4's parser table walks into. `mission_revisions` has no unique
    // constraint and the section does not shrink, so re-parsing it every run
    // triples a ledger the product reads as a drift signal. The revision comes
    // from `applyEdit`'s field diff instead — nothing here parses history into a
    // row at all.
    await run({
      "MISSION.md":
        "# Mission\n\n## Topic\n\nRLS\n\n## History\n\n- 2026-08-01: Created.\n- 2026-08-05: Narrowed.\n",
    });

    expect(h.update).toHaveBeenCalledTimes(1);
    const [, , input] = h.update.mock.calls[0]!;
    expect(input).not.toHaveProperty("history");
  });
});

describe("parse warnings", () => {
  it("collects them rather than throwing, so the run survives a format change", async () => {
    const result = await run({
      "lessons/0007-rls.html": "<p>no title, no headings</p>",
      "MISSION.md": "# Mission\n\n## Surprise\n\nSomething new.\n",
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.map((w) => w.code)).toContain("title_missing");
  });

  it("does not throw on an empty workspace", async () => {
    await expect(run({})).resolves.toMatchObject({ lessons: 0, warnings: [] });
  });
});

describe("CURRICULUM.md", () => {
  const CURRICULUM = `# Curriculum

## Subject

AWS

## Tracks

| Order | Slug       | Track            | Outcome        | Prerequisites |
| ----- | ---------- | ---------------- | -------------- | ------------- |
| 1     | iam-basics | IAM fundamentals | Read a policy  | —             |
| 2     | iam-deep   | IAM in anger     | Write a policy | iam-basics    |
`;

  it("turns the file into tracks, their order and their prerequisites", async () => {
    const result = await run({ "CURRICULUM.md": CURRICULUM });

    expect(result.tracks).toBe(2);
    expect(h.saved.tracks.map((t) => t.slug)).toEqual(["iam-basics", "iam-deep"]);
    expect(h.saved.tracks[1]).toMatchObject({
      name: "IAM in anger",
      outcome: "Write a policy",
      position: 2,
      prerequisiteSlugs: ["iam-basics"],
    });
  });

  it("files a lesson under the track its own meta tag names", async () => {
    const result = await run({
      "CURRICULUM.md": CURRICULUM,
      "lessons/0001-policies.html": `<title>Policies</title>
        <meta name="mindforge:track" content="iam-basics" />
        <body><p>x</p></body>`,
    });

    expect(h.saved.lessons[0]).toMatchObject({ trackId: "track-iam-basics" });
    expect(result.warnings.map((w) => w.code)).not.toContain("value_unknown");
  });

  it("resolves a lesson's track on a run that did not touch the curriculum", async () => {
    // This is the normal shape of a teach run: one new lesson, and CURRICULUM.md
    // untouched because the agent is told it is an input. A resolver that only
    // knew the tracks parsed *this* run would file every real lesson under no
    // module at all.
    await run({ "CURRICULUM.md": CURRICULUM });
    h.saved.lessons.length = 0;

    await run({
      "lessons/0002-more.html": `<title>More</title>
        <meta name="mindforge:track" content="iam-deep" />
        <body><p>x</p></body>`,
    });

    expect(h.saved.lessons[0]).toMatchObject({ trackId: "track-iam-deep" });
  });

  it("leaves a lesson unfiled and warns when it names a track that does not exist", async () => {
    // Invisible otherwise, and the shape of the failure is a module that quietly
    // looks shorter than it is.
    const result = await run({
      "CURRICULUM.md": CURRICULUM,
      "lessons/0001-ghost.html": `<title>Ghost</title>
        <meta name="mindforge:track" content="imaginary" />
        <body><p>x</p></body>`,
    });

    expect(h.saved.lessons[0]!.trackId).toBeNull();
    expect(result.warnings.map((w) => w.code)).toContain("value_unknown");
  });

  it("files a lesson with no meta tag under no module, without complaining", async () => {
    // Legal and permanent: lessons written before the mission had a curriculum,
    // and lessons taught deliberately off-plan.
    const result = await run({
      "CURRICULUM.md": CURRICULUM,
      "lessons/0001-old.html": LESSON,
    });

    expect(h.saved.lessons[0]!.trackId).toBeNull();
    expect(result.warnings.map((w) => w.code)).not.toContain("value_unknown");
  });

  it("does not touch tracks at all when the file is absent from the run", async () => {
    // A run that did not write the curriculum must not restructure it. Without
    // this, every teach run would re-derive a module list from a file it never read.
    await run({ "lessons/0001-x.html": LESSON });

    expect(h.saved.tracks).toEqual([]);
  });

  it("keeps indexing lessons when the curriculum will not parse", async () => {
    // §7.4's degradation rule. A malformed table is not a reason to lose a lesson
    // the model spent ten minutes writing.
    const result = await run({
      "CURRICULUM.md": "# Curriculum\n\n## Tracks\n\nnot a table at all\n",
      "lessons/0001-x.html": LESSON,
    });

    expect(result.lessons).toBe(1);
    expect(result.tracks).toBe(0);
    expect(result.warnings.map((w) => w.code)).toContain("value_malformed");
  });
});

describe("the module tables", () => {
  const PLANNED = `# Curriculum

## Tracks

| Order | Slug       | Track            | Prerequisites |
| ----- | ---------- | ---------------- | ------------- |
| 1     | iam-basics | IAM fundamentals | —             |
| 2     | iam-deep   | IAM in anger     | iam-basics    |

## Module: iam-basics

| Slug           | Lesson              | Intent       | Difficulty | Depth    | Depends on     |
| -------------- | ------------------- | ------------ | ---------- | -------- | -------------- |
| policy-anatomy | Anatomy of a policy | Name a part  | 1          | overview | —              |
| policy-reading | Reading one         | Say what for | 2          | working  | policy-anatomy |
`;

  it("writes each module's lessons against the track they were planned under", async () => {
    const result = await run({ "CURRICULUM.md": PLANNED });

    expect(result.plannedLessons).toBe(2);
    expect(h.saved.planned[1]).toEqual({
      slug: "policy-reading",
      title: "Reading one",
      intent: "Say what for",
      difficulty: 2,
      depth: "working",
      position: 2,
      trackId: "track-iam-basics",
      prerequisiteSlugs: ["policy-anatomy"],
    });
  });

  it("plans nothing when the curriculum has no module tables yet", async () => {
    // The half-written curriculum, which is the normal state of a run that
    // stopped short. Its tracks still index.
    const result = await run({ "CURRICULUM.md": CURRICULUM_ONLY });

    expect(result.tracks).toBe(2);
    expect(result.plannedLessons).toBe(0);
    expect(h.saved.planned).toEqual([]);
  });

  it("does not plan anything on a run that did not write the curriculum", async () => {
    await run({ "lessons/0001-x.html": LESSON });
    expect(h.saved.planned).toEqual([]);
  });
});
