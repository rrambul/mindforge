import type { PrereqEdge } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import { SequentialIdGenerator } from "../../../shared/ids/id-generator.js";
import { FixedClock } from "../../../shared/time/clock.js";
import {
  PrerequisiteCycle,
  SelfPrerequisite,
  SkillNameTaken,
  SkillNotFound,
} from "../domain/errors.js";
import { Skill } from "../domain/skill.js";
import type { SkillFilter, SkillRepository } from "../domain/skill.repository.js";
import {
  AddPrerequisite,
  CreateSkill,
  DeleteSkill,
  EditSkill,
  GetSkill,
  ListSkills,
  RateSkill,
  RemovePrerequisite,
} from "./skill.use-cases.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const MISSING = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-08-06T12:00:00Z");

class InMemorySkills implements SkillRepository {
  private readonly byUser = new Map<string, Map<string, Skill>>();
  private readonly edgesByUser = new Map<string, PrereqEdge[]>();
  saveCount = 0;
  deleted: string[] = [];

  private own(userId: string): Map<string, Skill> {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const created = new Map<string, Skill>();
    this.byUser.set(userId, created);
    return created;
  }

  private ownEdges(userId: string): PrereqEdge[] {
    const existing = this.edgesByUser.get(userId);
    if (existing) return existing;
    const created: PrereqEdge[] = [];
    this.edgesByUser.set(userId, created);
    return created;
  }

  findById(userId: string, id: string): Promise<Skill | null> {
    return Promise.resolve(this.own(userId).get(id) ?? null);
  }

  findBySlug(userId: string, slug: string): Promise<Skill | null> {
    return Promise.resolve([...this.own(userId).values()].find((s) => s.slug === slug) ?? null);
  }

  list(userId: string, filter: SkillFilter): Promise<Skill[]> {
    const all = [...this.own(userId).values()].sort((a, b) => a.name.localeCompare(b.name));
    return Promise.resolve(filter.limit === undefined ? all : all.slice(0, filter.limit));
  }

  save(userId: string, skill: Skill): Promise<void> {
    this.saveCount += 1;
    this.own(userId).set(skill.id, skill);
    return Promise.resolve();
  }

  delete(userId: string, id: string): Promise<void> {
    this.deleted.push(id);
    this.own(userId).delete(id);
    // The schema cascades; the fake has to as well, or a test would see an edge to nothing.
    this.edgesByUser.set(
      userId,
      this.ownEdges(userId).filter((e) => e.skillId !== id && e.prereqId !== id),
    );
    return Promise.resolve();
  }

  edges(userId: string): Promise<PrereqEdge[]> {
    return Promise.resolve([...this.ownEdges(userId)]);
  }

  addEdge(userId: string, edge: PrereqEdge): Promise<void> {
    const edges = this.ownEdges(userId);
    if (!edges.some((e) => e.skillId === edge.skillId && e.prereqId === edge.prereqId)) {
      edges.push(edge);
    }
    return Promise.resolve();
  }

  removeEdge(userId: string, edge: PrereqEdge): Promise<void> {
    this.edgesByUser.set(
      userId,
      this.ownEdges(userId).filter(
        (e) => !(e.skillId === edge.skillId && e.prereqId === edge.prereqId),
      ),
    );
    return Promise.resolve();
  }
}

let skills: InMemorySkills;
let ids: SequentialIdGenerator;
const clock = new FixedClock(NOW);

function create(): CreateSkill {
  return new CreateSkill(skills, clock, ids);
}

/** Seeds a named skill and returns its id. */
async function seed(name: string, userId = ALICE): Promise<string> {
  const skill = await create().execute(userId, { name, prerequisiteIds: [] });
  return skill.id;
}

beforeEach(() => {
  skills = new InMemorySkills();
  ids = new SequentialIdGenerator();
});

describe("CreateSkill", () => {
  it("takes a name alone", async () => {
    const skill = await create().execute(ALICE, { name: "Rust ownership", prerequisiteIds: [] });

    expect(skill.name).toBe("Rust ownership");
    expect(skill.slug).toBe("rust-ownership");
    expect(skill.score).toBeNull();
  });

  it("records a self-rating without it becoming evidence", async () => {
    const skill = await create().execute(ALICE, {
      name: "Rust",
      perceivedLevel: 70,
      prerequisiteIds: [],
    });

    expect(skill.perceivedLevel).toBe(70);
    expect(skill.currentScore(NOW)).toBeNull();
  });

  it("refuses a duplicate name rather than letting the constraint 500", async () => {
    // "Rust" twice is almost always a mistake, and a driver error is a worse way to be told.
    await seed("Rust");
    await expect(
      create().execute(ALICE, { name: "Rust", prerequisiteIds: [] }),
    ).rejects.toBeInstanceOf(SkillNameTaken);
  });

  it("treats names that slug the same as duplicates", async () => {
    // "Rust Ownership" and "rust ownership" are the same skill, and the slug is what the link uses.
    await seed("Rust Ownership");
    await expect(
      create().execute(ALICE, { name: "rust  ownership", prerequisiteIds: [] }),
    ).rejects.toBeInstanceOf(SkillNameTaken);
  });

  it("lets two users have a skill with the same name", async () => {
    await seed("Rust");
    await expect(
      create().execute(BOB, { name: "Rust", prerequisiteIds: [] }),
    ).resolves.toMatchObject({ name: "Rust" });
  });

  it("declares prerequisites at creation, when they are most obvious", async () => {
    const borrowing = await seed("Borrowing");
    const skill = await create().execute(ALICE, {
      name: "Lifetimes",
      prerequisiteIds: [borrowing],
    });

    await expect(skills.edges(ALICE)).resolves.toEqual([
      { skillId: skill.id, prereqId: borrowing },
    ]);
  });

  it("is idempotent on a replayed id", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    await create().execute(ALICE, { id, name: "first", prerequisiteIds: [] });
    const replay = await create().execute(ALICE, { id, name: "second", prerequisiteIds: [] });

    expect(replay.name).toBe("first");
    expect(skills.saveCount).toBe(1);
  });
});

describe("the DAG (FR-S1)", () => {
  it("adds a prerequisite", async () => {
    const lifetimes = await seed("Lifetimes");
    const borrowing = await seed("Borrowing");

    await new AddPrerequisite(skills).execute(ALICE, lifetimes, borrowing);
    await expect(skills.edges(ALICE)).resolves.toEqual([
      { skillId: lifetimes, prereqId: borrowing },
    ]);
  });

  it("refuses a skill requiring itself", async () => {
    const rust = await seed("Rust");
    await expect(new AddPrerequisite(skills).execute(ALICE, rust, rust)).rejects.toBeInstanceOf(
      SelfPrerequisite,
    );
  });

  it("refuses the direct reverse of an existing edge", async () => {
    const a = await seed("A");
    const b = await seed("B");
    const add = new AddPrerequisite(skills);

    await add.execute(ALICE, a, b);
    await expect(add.execute(ALICE, b, a)).rejects.toBeInstanceOf(PrerequisiteCycle);
  });

  it("refuses a transitive cycle — the case a naive check misses", async () => {
    // A→B, B→C, then C→A. Nothing directly connects C to A, so a check that only looked for the
    // reverse edge would let this through — and a cycle means every skill in it is blocked by itself,
    // leaving the ZPD recommendation with nothing to suggest and the list with no order.
    const a = await seed("A");
    const b = await seed("B");
    const c = await seed("C");
    const add = new AddPrerequisite(skills);

    await add.execute(ALICE, a, b);
    await add.execute(ALICE, b, c);

    await expect(add.execute(ALICE, c, a)).rejects.toBeInstanceOf(PrerequisiteCycle);
  });

  it("refuses a longer transitive cycle", async () => {
    const names = ["A", "B", "C", "D", "E"];
    const created: string[] = [];
    for (const name of names) created.push(await seed(name));
    const add = new AddPrerequisite(skills);

    for (let i = 0; i < created.length - 1; i += 1) {
      await add.execute(ALICE, created[i]!, created[i + 1]!);
    }

    await expect(
      add.execute(ALICE, created[created.length - 1]!, created[0]!),
    ).rejects.toBeInstanceOf(PrerequisiteCycle);
  });

  it("leaves the graph untouched when it refuses one", async () => {
    // A rejected edge that was written anyway would leave the store in the state the check exists to
    // prevent, and every later check would then be reading a cyclic graph.
    const a = await seed("A");
    const b = await seed("B");
    const add = new AddPrerequisite(skills);

    await add.execute(ALICE, a, b);
    await expect(add.execute(ALICE, b, a)).rejects.toThrow();

    await expect(skills.edges(ALICE)).resolves.toEqual([{ skillId: a, prereqId: b }]);
  });

  it("allows a diamond, which is not a cycle", async () => {
    // A requires B and C; both require D. A common shape — refusing it would make the graph a tree,
    // which is not what FR-S1 asks for.
    const a = await seed("A");
    const b = await seed("B");
    const c = await seed("C");
    const d = await seed("D");
    const add = new AddPrerequisite(skills);

    await add.execute(ALICE, a, b);
    await add.execute(ALICE, a, c);
    await add.execute(ALICE, b, d);
    await expect(add.execute(ALICE, c, d)).resolves.toBeUndefined();
  });

  it("refuses a cycle formed by two prerequisites declared at creation", async () => {
    // Each is fine on its own; together they close a loop. The check runs per edge as it is added,
    // which is what catches this.
    const a = await seed("A");
    const b = await seed("B");
    await new AddPrerequisite(skills).execute(ALICE, a, b);

    await expect(
      create().execute(ALICE, { name: "C", prerequisiteIds: [a] }),
    ).resolves.toBeDefined();
    // Now B requires C would close A→B→C→A.
    const c = await skills.findBySlug(ALICE, "c");
    await expect(new AddPrerequisite(skills).execute(ALICE, b, c!.id)).rejects.toBeInstanceOf(
      PrerequisiteCycle,
    );
  });

  it("cannot point at another user's skill", async () => {
    const alices = await seed("A");
    const bobs = await seed("B", BOB);

    await expect(new AddPrerequisite(skills).execute(ALICE, alices, bobs)).rejects.toBeInstanceOf(
      SkillNotFound,
    );
  });

  it("does not consider another user's edges when checking", async () => {
    // The graphs are separate. Bob having B→A must not stop Alice adding A→B.
    const alicesA = await seed("A");
    const alicesB = await seed("B");
    const bobsA = await seed("A", BOB);
    const bobsB = await seed("B", BOB);

    await new AddPrerequisite(skills).execute(BOB, bobsB, bobsA);
    await expect(
      new AddPrerequisite(skills).execute(ALICE, alicesA, alicesB),
    ).resolves.toBeUndefined();
  });

  it("removes an edge, and is idempotent about it", async () => {
    const a = await seed("A");
    const b = await seed("B");
    await new AddPrerequisite(skills).execute(ALICE, a, b);

    const remove = new RemovePrerequisite(skills);
    await remove.execute(ALICE, a, b);
    await expect(skills.edges(ALICE)).resolves.toEqual([]);
    // A repeated delete is not an error: the desired state is already true.
    await expect(remove.execute(ALICE, a, b)).resolves.toBeUndefined();
  });

  it("lets an edge be re-added after removal", async () => {
    // Removing can never create a cycle, so the graph must be genuinely clean afterwards.
    const a = await seed("A");
    const b = await seed("B");
    const add = new AddPrerequisite(skills);

    await add.execute(ALICE, a, b);
    await new RemovePrerequisite(skills).execute(ALICE, a, b);
    await expect(add.execute(ALICE, b, a)).resolves.toBeUndefined();
  });
});

describe("RateSkill (FR-S5)", () => {
  it("writes the rating and nothing else", async () => {
    const id = await seed("Rust");
    const rated = await new RateSkill(skills).execute(ALICE, id, { perceivedLevel: 85 });

    expect(rated.perceivedLevel).toBe(85);
    expect(rated.score).toBeNull();
  });

  it("reports another user's skill as not found", async () => {
    const id = await seed("Rust");
    await expect(
      new RateSkill(skills).execute(BOB, id, { perceivedLevel: 85 }),
    ).rejects.toBeInstanceOf(SkillNotFound);
  });
});

describe("EditSkill", () => {
  it("moves the slug with the name", async () => {
    // Stored so a rename does not break a link — but a slug still naming the old thing is a link that
    // lies about where it goes.
    const id = await seed("Rust");
    const edited = await new EditSkill(skills).execute(ALICE, id, { name: "Rust ownership" });

    expect(edited.slug).toBe("rust-ownership");
  });

  it("refuses a rename onto another skill's name", async () => {
    await seed("Borrowing");
    const rust = await seed("Rust");

    await expect(
      new EditSkill(skills).execute(ALICE, rust, { name: "Borrowing" }),
    ).rejects.toBeInstanceOf(SkillNameTaken);
  });

  it("allows renaming a skill to what it already is", async () => {
    // The clash check must not see the skill itself.
    const rust = await seed("Rust");
    await expect(
      new EditSkill(skills).execute(ALICE, rust, { name: "Rust" }),
    ).resolves.toMatchObject({ name: "Rust" });
  });

  it("rejects an unknown skill", async () => {
    await expect(
      new EditSkill(skills).execute(ALICE, MISSING, { name: "x" }),
    ).rejects.toBeInstanceOf(SkillNotFound);
  });
});

describe("DeleteSkill", () => {
  it("takes its edges with it", async () => {
    // An edge to a deleted skill is an edge to nothing, and leaving it would break the ordering of
    // everything downstream.
    const a = await seed("A");
    const b = await seed("B");
    await new AddPrerequisite(skills).execute(ALICE, a, b);

    await new DeleteSkill(skills).execute(ALICE, b);
    await expect(skills.edges(ALICE)).resolves.toEqual([]);
  });

  it("refuses another user's skill, and does not touch it", async () => {
    const id = await seed("Rust");
    await expect(new DeleteSkill(skills).execute(BOB, id)).rejects.toBeInstanceOf(SkillNotFound);
    expect(skills.deleted).toEqual([]);
  });
});

describe("ListSkills", () => {
  it("puts a prerequisite before what needs it", async () => {
    const lifetimes = await seed("Lifetimes");
    const borrowing = await seed("Borrowing");
    await new AddPrerequisite(skills).execute(ALICE, lifetimes, borrowing);

    const listed = await new ListSkills(skills, clock).execute(ALICE, {});
    expect(listed.map((d) => d.skill.name)).toEqual(["Borrowing", "Lifetimes"]);
  });

  it("still lists a skill with no edges", async () => {
    await seed("Loose");
    const listed = await new ListSkills(skills, clock).execute(ALICE, {});
    expect(listed).toHaveLength(1);
  });

  it("reports each skill's direct prerequisites", async () => {
    const lifetimes = await seed("Lifetimes");
    const borrowing = await seed("Borrowing");
    await new AddPrerequisite(skills).execute(ALICE, lifetimes, borrowing);

    const listed = await new ListSkills(skills, clock).execute(ALICE, {});
    const found = listed.find((d) => d.skill.id === lifetimes)!;
    expect(found.prerequisiteIds).toEqual([borrowing]);
  });

  it("filters to the overconfident ones, which is the list worth looking at", async () => {
    // Needs a score to compare against, and M1 has none — so this is exercised through a snapshot
    // rather than through the create path, which cannot produce one by design.
    const overconfident = Skill.fromSnapshot({
      id: "44444444-4444-4444-8444-444444444444",
      userId: ALICE,
      name: "Overrated",
      slug: "overrated",
      description: null,
      perceivedLevel: 90,
      score: 40,
      scoreStdDev: null,
      halfLifeDays: 90,
      lastEvidenceAt: NOW,
      createdAt: NOW,
    });
    await skills.save(ALICE, overconfident);
    await seed("Unrated");

    const listed = await new ListSkills(skills, clock).execute(ALICE, {
      overconfidentOnly: true,
    });
    expect(listed.map((d) => d.skill.name)).toEqual(["Overrated"]);
  });

  it("does not treat an unproven skill as calibrated", async () => {
    // A skill rated 90 with no evidence must not be filtered out of the overconfident list *and* also
    // not be silently claimed as calibrated — it is unmeasurable, and the verdict says so.
    await create().execute(ALICE, { name: "Unproven", perceivedLevel: 90, prerequisiteIds: [] });

    const listed = await new ListSkills(skills, clock).execute(ALICE, {});
    expect(listed[0]?.calibration.verdict).toBeNull();
    expect(listed[0]?.calibration.missing).toBe("score");
  });

  it("never lists another user's skills", async () => {
    await seed("Rust");
    await expect(new ListSkills(skills, clock).execute(BOB, {})).resolves.toEqual([]);
  });
});

describe("GetSkill", () => {
  it("reports a missing skill rather than an empty one", async () => {
    await expect(new GetSkill(skills, clock).execute(ALICE, MISSING)).rejects.toBeInstanceOf(
      SkillNotFound,
    );
  });

  it("includes the prerequisites and the calibration", async () => {
    const lifetimes = await seed("Lifetimes");
    const borrowing = await seed("Borrowing");
    await new AddPrerequisite(skills).execute(ALICE, lifetimes, borrowing);
    await new RateSkill(skills).execute(ALICE, lifetimes, { perceivedLevel: 60 });

    const found = await new GetSkill(skills, clock).execute(ALICE, lifetimes);
    expect(found.prerequisiteIds).toEqual([borrowing]);
    expect(found.calibration.missing).toBe("score");
  });
});
