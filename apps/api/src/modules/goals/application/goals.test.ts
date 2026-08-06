import type { TargetEvidence } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import { SequentialIdGenerator } from "../../../shared/ids/id-generator.js";
import { FixedClock } from "../../../shared/time/clock.js";
import {
  GoalNotFound,
  GoalTargetNotFound,
  TargetNotManual,
  TargetSubjectMissing,
} from "../domain/errors.js";
import type { Goal } from "../domain/goal.js";
import type { GoalFilter, GoalRepository } from "../domain/goal.repository.js";
import type { EvidenceRequest, GoalEvidenceReader } from "./evidence.port.js";
import {
  AddGoalTarget,
  CloseGoal,
  CreateGoal,
  EditGoal,
  GetGoal,
  ListGoals,
  RecomputeGoal,
  RemoveGoalTarget,
  ReopenGoal,
  SetManualTarget,
} from "./goal.use-cases.js";
import type { SubjectExistenceReader } from "./subject-existence.port.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const RESOURCE = "33333333-3333-4333-8333-333333333333";
const MISSION = "44444444-4444-4444-8444-444444444444";
const SKILL = "55555555-5555-4555-8555-555555555555";
const MISSING = "66666666-6666-4666-8666-666666666666";
const NOW = new Date("2026-08-06T12:00:00Z");
const LATER = new Date("2026-08-07T09:00:00Z");

class InMemoryGoals implements GoalRepository {
  private readonly byUser = new Map<string, Map<string, Goal>>();
  saveCount = 0;
  metAtWrites = 0;
  deletedTargets: string[] = [];

  private own(userId: string): Map<string, Goal> {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const created = new Map<string, Goal>();
    this.byUser.set(userId, created);
    return created;
  }

  findById(userId: string, id: string): Promise<Goal | null> {
    return Promise.resolve(this.own(userId).get(id) ?? null);
  }

  list(userId: string, filter: GoalFilter): Promise<Goal[]> {
    let all = [...this.own(userId).values()];
    if (filter.status) all = all.filter((g) => g.status === filter.status);
    if (filter.missionId) all = all.filter((g) => g.missionId === filter.missionId);
    if (filter.limit !== undefined) all = all.slice(0, filter.limit);
    return Promise.resolve(all);
  }

  save(userId: string, goal: Goal): Promise<void> {
    this.saveCount += 1;
    this.own(userId).set(goal.id, goal);
    return Promise.resolve();
  }

  deleteTarget(_userId: string, _goalId: string, targetId: string): Promise<void> {
    this.deletedTargets.push(targetId);
    return Promise.resolve();
  }

  saveTargetMetAt(): Promise<void> {
    this.metAtWrites += 1;
    return Promise.resolve();
  }
}

/** Everything exists and no skill has a score — the state of the world in M1. */
class StubSubjects implements SubjectExistenceReader {
  readonly missing = new Set<string>();
  scores = new Map<string, number | null>();

  exists(_userId: string, _subject: string, id: string): Promise<boolean> {
    return Promise.resolve(!this.missing.has(id));
  }

  skillScore(_userId: string, skillId: string): Promise<number | null> {
    return Promise.resolve(this.scores.get(skillId) ?? null);
  }
}

class StubEvidence implements GoalEvidenceReader {
  byTarget: Record<string, TargetEvidence> = {};
  calls = 0;
  lastBatchSize = 0;
  /** Recorded so a test can assert the window the caller asked for (§3.8). */
  lastWindows: Date[] = [];

  read(
    _userId: string,
    requests: readonly EvidenceRequest[],
  ): Promise<Readonly<Record<string, TargetEvidence>>> {
    this.calls += 1;
    this.lastBatchSize = requests.length;
    this.lastWindows = requests.map((request) => request.countFrom);
    return Promise.resolve(this.byTarget);
  }
}

let goals: InMemoryGoals;
let subjects: StubSubjects;
let evidence: StubEvidence;
/**
 * Shared across a test rather than built per call.
 *
 * A fresh `SequentialIdGenerator` restarts at the same value, so two goals seeded in one test both
 * got id "1" and the second silently replaced the first — which read as an assertion about batching
 * and was an assertion about the harness.
 */
let ids: SequentialIdGenerator;

function makeCreate(): CreateGoal {
  return new CreateGoal(goals, subjects, new FixedClock(NOW), ids);
}

beforeEach(() => {
  goals = new InMemoryGoals();
  subjects = new StubSubjects();
  evidence = new StubEvidence();
  ids = new SequentialIdGenerator();
});

describe("CreateGoal", () => {
  it("takes a title alone, with no targets", async () => {
    // A goal you have written down but not yet worked out how to measure is a real state.
    const goal = await makeCreate().execute(ALICE, { title: "Ship the parser", targets: [] });

    expect(goal.title).toBe("Ship the parser");
    expect(goal.targets).toEqual([]);
    expect(goal.progress().fraction).toBeNull();
  });

  it("creates the targets alongside it", async () => {
    const goal = await makeCreate().execute(ALICE, {
      title: "Read it properly",
      targets: [
        { kind: "resource_progress", resourceId: RESOURCE, target: { percent: 100 }, weight: 1 },
        { kind: "focus_hours", missionId: MISSION, target: { hours: 20 }, weight: 2 },
      ],
    });

    expect(goal.targets).toHaveLength(2);
    expect(goal.targets[1]?.weight).toBe(2);
  });

  it("refuses a target pointing at something that is not there", async () => {
    // Left to the foreign key this arrives as a driver error and becomes a 500, and it is reachable
    // just by having two tabs open.
    subjects.missing.add(MISSING);

    await expect(
      makeCreate().execute(ALICE, {
        title: "x",
        targets: [
          { kind: "resource_progress", resourceId: MISSING, target: { percent: 50 }, weight: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(TargetSubjectMissing);
  });

  it("does not check a subject for the kinds that have none", async () => {
    const goal = await makeCreate().execute(ALICE, {
      title: "Ship it",
      targets: [{ kind: "manual", target: {}, weight: 1 }],
    });
    expect(goal.targets).toHaveLength(1);
  });

  describe("a skill_band target", () => {
    it("captures the band the skill is in now (§3.8)", async () => {
      // Unrecoverable later: once the skill moves, nothing remembers where the goal began.
      subjects.scores.set(SKILL, 55);

      const goal = await makeCreate().execute(ALICE, {
        title: "Get fluent",
        targets: [{ kind: "skill_band", skillId: SKILL, target: { band: "fluent" }, weight: 1 }],
      });

      expect(goal.targets[0]?.bandAtStart).toBe("working");
    });

    it("records no starting band for an unproven skill", async () => {
      // A null score is unproven, which is not the lowest band — storing `aware` would invent an
      // observation that was never made.
      const goal = await makeCreate().execute(ALICE, {
        title: "Get fluent",
        targets: [{ kind: "skill_band", skillId: SKILL, target: { band: "fluent" }, weight: 1 }],
      });

      expect(goal.targets[0]?.bandAtStart).toBeNull();
    });
  });

  it("is idempotent on a replayed id", async () => {
    const id = "77777777-7777-4777-8777-777777777777";
    const create = makeCreate();

    await create.execute(ALICE, { id, title: "first", targets: [] });
    const replay = await create.execute(ALICE, { id, title: "second", targets: [] });

    expect(replay.title).toBe("first");
    expect(goals.saveCount).toBe(1);
  });
});

describe("EditGoal", () => {
  async function aGoal(): Promise<Goal> {
    return makeCreate().execute(ALICE, { title: "Original", targets: [] });
  }

  it("edits the title", async () => {
    const goal = await aGoal();
    const edit = new EditGoal(goals);

    expect((await edit.execute(ALICE, goal.id, { title: "Revised" })).title).toBe("Revised");
  });

  it("rejects an unknown goal", async () => {
    await expect(
      new EditGoal(goals).execute(ALICE, MISSING, { title: "x" }),
    ).rejects.toBeInstanceOf(GoalNotFound);
  });

  it("reports another user's goal as not found", async () => {
    const goal = await aGoal();
    await expect(
      new EditGoal(goals).execute(BOB, goal.id, { title: "hijacked" }),
    ).rejects.toBeInstanceOf(GoalNotFound);
  });
});

describe("CloseGoal and ReopenGoal", () => {
  async function aGoal(): Promise<Goal> {
    return makeCreate().execute(ALICE, { title: "Original", targets: [] });
  }

  it("closes as missed with the note", async () => {
    const goal = await aGoal();
    const closed = await new CloseGoal(goals).execute(ALICE, goal.id, {
      status: "missed",
      outcomeNote: "ran out of time",
    });

    expect(closed.status).toBe("missed");
    expect(closed.outcomeNote).toBe("ran out of time");
  });

  it("closes as met without one", async () => {
    const goal = await aGoal();
    const closed = await new CloseGoal(goals).execute(ALICE, goal.id, {
      status: "met",
    });
    expect(closed.outcomeNote).toBeNull();
  });

  it("reopens explicitly", async () => {
    const goal = await aGoal();
    await new CloseGoal(goals).execute(ALICE, goal.id, {
      status: "abandoned",
      outcomeNote: "changed direction",
    });

    const reopened = await new ReopenGoal(goals).execute(ALICE, goal.id);
    expect(reopened.status).toBe("active");
    expect(reopened.outcomeNote).toBeNull();
  });

  it("reports another user's goal as not found on both", async () => {
    const goal = await aGoal();
    await expect(
      new CloseGoal(goals).execute(BOB, goal.id, { status: "met" }),
    ).rejects.toBeInstanceOf(GoalNotFound);
    await expect(new ReopenGoal(goals).execute(BOB, goal.id)).rejects.toBeInstanceOf(GoalNotFound);
  });
});

describe("AddGoalTarget and RemoveGoalTarget", () => {
  async function aGoal(): Promise<Goal> {
    return makeCreate().execute(ALICE, { title: "Original", targets: [] });
  }

  function add(): AddGoalTarget {
    return new AddGoalTarget(goals, subjects, ids);
  }

  it("adds a target to an existing goal", async () => {
    const goal = await aGoal();
    const after = await add().execute(ALICE, goal.id, {
      kind: "focus_hours",
      missionId: MISSION,
      target: { hours: 40 },
      weight: 1,
    });

    expect(after.targets).toHaveLength(1);
  });

  it("is idempotent on a supplied id, so a retry is not a second target", async () => {
    const goal = await aGoal();
    const id = "88888888-8888-4888-8888-888888888888";
    const target = {
      id,
      kind: "manual" as const,
      target: {},
      weight: 1,
    };

    await add().execute(ALICE, goal.id, target);
    const after = await add().execute(ALICE, goal.id, target);

    expect(after.targets).toHaveLength(1);
  });

  it("refuses a target whose subject is missing", async () => {
    const goal = await aGoal();
    subjects.missing.add(MISSING);

    await expect(
      add().execute(ALICE, goal.id, {
        kind: "focus_hours",
        missionId: MISSING,
        target: { hours: 40 },
        weight: 1,
      }),
    ).rejects.toBeInstanceOf(TargetSubjectMissing);
  });

  it("removes a target", async () => {
    const goal = await aGoal();
    const withTarget = await add().execute(ALICE, goal.id, {
      kind: "manual",
      target: {},
      weight: 1,
    });
    const targetId = withTarget.targets[0]!.id;

    const after = await new RemoveGoalTarget(goals).execute(ALICE, goal.id, targetId);
    expect(after.targets).toEqual([]);
    expect(goals.deletedTargets).toEqual([targetId]);
  });

  it("reports an unknown target rather than succeeding silently", async () => {
    const goal = await aGoal();
    await expect(
      new RemoveGoalTarget(goals).execute(ALICE, goal.id, MISSING),
    ).rejects.toBeInstanceOf(GoalTargetNotFound);
    expect(goals.deletedTargets).toEqual([]);
  });
});

describe("SetManualTarget", () => {
  async function goalWithManual(): Promise<{ goal: Goal; targetId: string }> {
    const goal = await makeCreate().execute(ALICE, {
      title: "Ship it",
      targets: [{ kind: "manual", target: {}, weight: 1 }],
    });
    return { goal, targetId: goal.targets[0]!.id };
  }

  it("ticks and unticks a manual target", async () => {
    const { goal, targetId } = await goalWithManual();
    const set = new SetManualTarget(goals, new FixedClock(LATER));

    const ticked = await set.execute(ALICE, goal.id, targetId, true);
    expect(ticked.findTarget(targetId)?.metAt).toEqual(LATER);
    expect(ticked.progress().fraction).toBe(1);

    const unticked = await set.execute(ALICE, goal.id, targetId, false);
    expect(unticked.findTarget(targetId)?.metAt).toBeNull();
  });

  it("refuses to set a computed target", async () => {
    // The one rule §3.8 exists for: every other kind comes from evidence.
    const goal = await makeCreate().execute(ALICE, {
      title: "Read it",
      targets: [
        { kind: "resource_progress", resourceId: RESOURCE, target: { percent: 100 }, weight: 1 },
      ],
    });

    await expect(
      new SetManualTarget(goals, new FixedClock(LATER)).execute(
        ALICE,
        goal.id,
        goal.targets[0]!.id,
        true,
      ),
    ).rejects.toBeInstanceOf(TargetNotManual);
  });

  it("rejects an unknown target", async () => {
    const { goal } = await goalWithManual();
    await expect(
      new SetManualTarget(goals, new FixedClock(LATER)).execute(ALICE, goal.id, MISSING, true),
    ).rejects.toBeInstanceOf(GoalTargetNotFound);
  });
});

describe("ListGoals", () => {
  async function seed(title: string, hours = 40): Promise<Goal> {
    return makeCreate().execute(ALICE, {
      title,
      targets: [{ kind: "focus_hours", missionId: MISSION, target: { hours }, weight: 1 }],
    });
  }

  it("reads evidence once for every target on the screen", async () => {
    // One call per goal would make a five-goal screen five round trips, and progress is derived on
    // every read (§3.8) — so this is the hot path.
    await seed("first");
    await seed("second");

    await new ListGoals(goals, evidence).execute(ALICE, {});

    expect(evidence.calls).toBe(1);
    expect(evidence.lastBatchSize).toBe(2);
  });

  it("computes each goal's progress from that evidence", async () => {
    const goal = await seed("first", 20);
    evidence.byTarget = { [goal.targets[0]!.id]: { focusMinutes: 600 } };

    const listed = await new ListGoals(goals, evidence).execute(ALICE, {});
    expect(listed[0]?.progress.fraction).toBeCloseTo(0.5);
  });

  it("does not read evidence at all when there are no goals", async () => {
    await new ListGoals(goals, evidence).execute(ALICE, {});
    // Called with an empty batch is fine; what matters is the reader is free to short-circuit.
    expect(evidence.lastBatchSize).toBe(0);
  });

  it("never lists another user's goals", async () => {
    await seed("alice's");
    await expect(new ListGoals(goals, evidence).execute(BOB, {})).resolves.toEqual([]);
  });
});

describe("GetGoal", () => {
  it("reports a missing goal rather than an empty one", async () => {
    await expect(new GetGoal(goals, evidence).execute(ALICE, MISSING)).rejects.toBeInstanceOf(
      GoalNotFound,
    );
  });

  it("does not write anything", async () => {
    // A GET that stamps rows makes every page load a mutation, and makes a refresh change the data
    // you are looking at.
    const goal = await makeCreate().execute(ALICE, {
      title: "Read it",
      targets: [{ kind: "focus_hours", missionId: MISSION, target: { hours: 1 }, weight: 1 }],
    });
    evidence.byTarget = { [goal.targets[0]!.id]: { focusMinutes: 600 } };

    const before = goals.saveCount;
    await new GetGoal(goals, evidence).execute(ALICE, goal.id);

    expect(goals.saveCount).toBe(before);
    expect(goals.metAtWrites).toBe(0);
    // And the target is still unstamped, even though it is plainly met.
    expect(goal.targets[0]?.metAt).toBeNull();
  });
});

describe("RecomputeGoal", () => {
  async function goalWithHours(hours: number): Promise<Goal> {
    return makeCreate().execute(ALICE, {
      title: "Put the time in",
      targets: [{ kind: "focus_hours", missionId: MISSION, target: { hours }, weight: 1 }],
    });
  }

  it("stamps a target that has become met", async () => {
    const goal = await goalWithHours(10);
    evidence.byTarget = { [goal.targets[0]!.id]: { focusMinutes: 600 } };

    const result = await new RecomputeGoal(goals, evidence, new FixedClock(LATER)).execute(
      ALICE,
      goal.id,
    );

    expect(result.goal.targets[0]?.metAt).toEqual(LATER);
    expect(goals.metAtWrites).toBe(1);
  });

  it("writes nothing when nothing moved", async () => {
    // Runs on every mutation touching a source and nightly across every goal; most of the time
    // nothing has changed and a write would be pure noise.
    const goal = await goalWithHours(40);
    evidence.byTarget = { [goal.targets[0]!.id]: { focusMinutes: 600 } };

    await new RecomputeGoal(goals, evidence, new FixedClock(LATER)).execute(ALICE, goal.id);
    expect(goals.metAtWrites).toBe(0);
  });

  it("un-stamps a target that stopped being met (FR-M3b)", async () => {
    const goal = await makeCreate().execute(ALICE, {
      title: "Get fluent",
      targets: [{ kind: "skill_band", skillId: SKILL, target: { band: "fluent" }, weight: 1 }],
    });
    const targetId = goal.targets[0]!.id;
    const recompute = new RecomputeGoal(goals, evidence, new FixedClock(LATER));

    evidence.byTarget = { [targetId]: { skillScore: 75 } };
    await recompute.execute(ALICE, goal.id);
    expect(goal.findTarget(targetId)?.metAt).toEqual(LATER);

    // The skill decays below the band. The goal un-meets itself, which is the point.
    evidence.byTarget = { [targetId]: { skillScore: 55 } };
    await recompute.execute(ALICE, goal.id);
    expect(goal.findTarget(targetId)?.metAt).toBeNull();
  });

  it("reports another user's goal as not found", async () => {
    const goal = await goalWithHours(10);
    await expect(
      new RecomputeGoal(goals, evidence, new FixedClock(LATER)).execute(BOB, goal.id),
    ).rejects.toBeInstanceOf(GoalNotFound);
  });
});
