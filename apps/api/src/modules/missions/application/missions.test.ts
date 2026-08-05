import { MISSION_WIP_LIMIT, type CreateMissionInput, type MissionStatus } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import { SequentialIdGenerator } from "../../../shared/ids/id-generator.js";
import { FixedClock } from "../../../shared/time/clock.js";
import {
  MissionNotActive,
  MissionNotFound,
  MissionNotParked,
  WipLimitReached,
} from "../domain/errors.js";
import { Mission, type MissionRevisionDraft } from "../domain/mission.js";
import type { MissionFilter, MissionRepository } from "../domain/mission.repository.js";
import { CreateMission } from "./create-mission.js";
import { ParkMission, UnparkMission } from "./park-mission.js";
import { GetMission, ListMissions } from "./read-missions.js";
import { UpdateMission } from "./update-mission.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-05T12:00:00Z");

const INPUT: CreateMissionInput = {
  topic: "Rust ownership",
  why: "I keep fighting the borrow checker",
  successLooksLike: null,
  constraints: null,
  currentLevel: null,
};

/**
 * The repository interface makes a fake trivial, which is the point of §13.2's
 * "test the rule, not the SQL". These tests are about the WIP limit and the
 * revision, not about Prisma — the real repository is covered by the integration
 * suite against Postgres.
 *
 * It keys by userId even though RLS would do that in production, so a use case that
 * forgot to pass one would fail here rather than silently sharing rows between test
 * users.
 */
class InMemoryMissions implements MissionRepository {
  private readonly byUser = new Map<string, Map<string, Mission>>();
  readonly revisions: MissionRevisionDraft[] = [];

  private own(userId: string): Map<string, Mission> {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const created = new Map<string, Mission>();
    this.byUser.set(userId, created);
    return created;
  }

  findById(userId: string, id: string): Promise<Mission | null> {
    return Promise.resolve(this.own(userId).get(id) ?? null);
  }

  list(userId: string, filter: MissionFilter): Promise<Mission[]> {
    const all = [...this.own(userId).values()];
    return Promise.resolve(filter.status ? all.filter((m) => m.status === filter.status) : all);
  }

  countActive(userId: string): Promise<number> {
    return Promise.resolve(
      [...this.own(userId).values()].filter((m) => m.status === "active").length,
    );
  }

  create(userId: string, mission: Mission): Promise<void> {
    this.own(userId).set(mission.id, mission);
    return Promise.resolve();
  }

  update(userId: string, mission: Mission, revision: MissionRevisionDraft | null): Promise<void> {
    this.own(userId).set(mission.id, mission);
    if (revision) this.revisions.push(revision);
    return Promise.resolve();
  }

  /** Test setup shortcut — bypasses the WIP limit deliberately. */
  seed(userId: string, topic: string, status: MissionStatus): Mission {
    const mission = Mission.fromSnapshot({
      id: `00000000-0000-4000-9000-${this.own(userId).size.toString(16).padStart(12, "0")}`,
      userId,
      topic,
      why: null,
      successLooksLike: null,
      constraints: null,
      currentLevel: null,
      status,
      workspaceKey: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    this.own(userId).set(mission.id, mission);
    return mission;
  }
}

describe("CreateMission", () => {
  let missions: InMemoryMissions;
  let create: CreateMission;

  beforeEach(() => {
    missions = new InMemoryMissions();
    create = new CreateMission(missions, new FixedClock(NOW), new SequentialIdGenerator());
  });

  it("creates an active mission with a generated id", async () => {
    const mission = await create.execute(ALICE, INPUT);

    expect(mission.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(mission.status).toBe("active");
    expect(mission.fields.topic).toBe("Rust ownership");
    expect(mission.createdAt).toEqual(NOW);
  });

  it("persists it under the caller's id", async () => {
    const mission = await create.execute(ALICE, INPUT);
    await expect(missions.findById(ALICE, mission.id)).resolves.not.toBeNull();
    await expect(missions.findById(BOB, mission.id)).resolves.toBeNull();
  });

  it(`allows exactly ${MISSION_WIP_LIMIT} active missions`, async () => {
    for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) {
      await create.execute(ALICE, { ...INPUT, topic: `Mission ${i}` });
    }
    await expect(missions.countActive(ALICE)).resolves.toBe(MISSION_WIP_LIMIT);
  });

  it("refuses the one past the limit (FR-M4)", async () => {
    for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) {
      await create.execute(ALICE, { ...INPUT, topic: `Mission ${i}` });
    }
    await expect(create.execute(ALICE, INPUT)).rejects.toBeInstanceOf(WipLimitReached);
  });

  it("reports the limit in the error, so the message can name a number", async () => {
    for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) {
      await create.execute(ALICE, { ...INPUT, topic: `Mission ${i}` });
    }
    await expect(create.execute(ALICE, INPUT)).rejects.toMatchObject({
      slug: "wip-limit-reached",
      detailVars: { limit: MISSION_WIP_LIMIT },
    });
  });

  it("counts only active missions towards the limit", async () => {
    // The whole point of parking: it is the pressure valve that makes the limit
    // livable. If parked missions counted, the limit would just be a wall.
    for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) missions.seed(ALICE, `Parked ${i}`, "parked");
    await expect(create.execute(ALICE, INPUT)).resolves.toBeInstanceOf(Mission);
  });

  it.each(["completed", "abandoned"] as const)("does not count a %s mission", async (status) => {
    for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) missions.seed(ALICE, `Old ${i}`, status);
    await expect(create.execute(ALICE, INPUT)).resolves.toBeInstanceOf(Mission);
  });

  it("counts each user's missions separately", async () => {
    for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) missions.seed(BOB, `Bob ${i}`, "active");
    await expect(create.execute(ALICE, INPUT)).resolves.toBeInstanceOf(Mission);
  });
});

describe("UpdateMission", () => {
  let missions: InMemoryMissions;
  let update: UpdateMission;

  beforeEach(() => {
    missions = new InMemoryMissions();
    update = new UpdateMission(missions, new FixedClock(NOW));
  });

  it("rejects an unknown mission", async () => {
    await expect(
      update.execute(ALICE, "33333333-3333-4333-8333-333333333333", { topic: "Anything" }),
    ).rejects.toBeInstanceOf(MissionNotFound);
  });

  it("rejects another user's mission as not found", async () => {
    // RLS makes "not yours" and "does not exist" the same observation, and that is
    // the right answer: a 403 would confirm the id belongs to someone.
    const bobs = missions.seed(BOB, "Bob's mission", "active");
    await expect(update.execute(ALICE, bobs.id, { topic: "Stolen" })).rejects.toBeInstanceOf(
      MissionNotFound,
    );
  });

  it("applies the change and appends one revision", async () => {
    const mission = missions.seed(ALICE, "Rust ownership", "active");
    await update.execute(ALICE, mission.id, { topic: "Rust lifetimes", reason: "narrowed scope" });

    expect(missions.revisions).toHaveLength(1);
    expect(missions.revisions[0]).toMatchObject({
      missionId: mission.id,
      userId: ALICE,
      reason: "narrowed scope",
      changed: ["topic"],
      previous: { topic: "Rust ownership" },
    });
  });

  it("appends no revision when nothing actually changed", async () => {
    const mission = missions.seed(ALICE, "Rust ownership", "active");
    await update.execute(ALICE, mission.id, { topic: "Rust ownership", reason: "no-op" });
    expect(missions.revisions).toEqual([]);
  });

  it("edits a parked mission", async () => {
    // FR-M4b: parking freezes nagging, not the mission. Refining what you meant is
    // exactly what tends to happen while something is parked.
    const mission = missions.seed(ALICE, "Rust ownership", "parked");
    await update.execute(ALICE, mission.id, { topic: "Rust lifetimes" });

    const after = await missions.findById(ALICE, mission.id);
    expect(after?.fields.topic).toBe("Rust lifetimes");
    expect(after?.status).toBe("parked");
  });
});

describe("ParkMission", () => {
  let missions: InMemoryMissions;
  let park: ParkMission;

  beforeEach(() => {
    missions = new InMemoryMissions();
    park = new ParkMission(missions, new FixedClock(NOW));
  });

  it("parks an active mission", async () => {
    const mission = missions.seed(ALICE, "Rust", "active");
    await expect(park.execute(ALICE, mission.id)).resolves.toMatchObject({ status: "parked" });
  });

  it("rejects an unknown mission", async () => {
    await expect(
      park.execute(ALICE, "33333333-3333-4333-8333-333333333333"),
    ).rejects.toBeInstanceOf(MissionNotFound);
  });

  it("rejects a mission that is already parked", async () => {
    const mission = missions.seed(ALICE, "Rust", "parked");
    await expect(park.execute(ALICE, mission.id)).rejects.toBeInstanceOf(MissionNotActive);
  });

  it("records no revision — a status change is not drift", async () => {
    // FR-M2 is about mission *content* changing. Parking is tracked by status, and
    // filing it as drift would make the drift count meaningless.
    const mission = missions.seed(ALICE, "Rust", "active");
    await park.execute(ALICE, mission.id);
    expect(missions.revisions).toEqual([]);
  });
});

describe("UnparkMission", () => {
  let missions: InMemoryMissions;
  let unpark: UnparkMission;

  beforeEach(() => {
    missions = new InMemoryMissions();
    unpark = new UnparkMission(missions, new FixedClock(NOW));
  });

  it("unparks a parked mission", async () => {
    const mission = missions.seed(ALICE, "Rust", "parked");
    await expect(unpark.execute(ALICE, mission.id)).resolves.toMatchObject({ status: "active" });
  });

  it("enforces the WIP limit on the way back in", async () => {
    // Otherwise parking three and unparking them all is a supported route around
    // FR-M4, and the limit protects nothing.
    for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) missions.seed(ALICE, `Active ${i}`, "active");
    const parked = missions.seed(ALICE, "Waiting", "parked");

    await expect(unpark.execute(ALICE, parked.id)).rejects.toBeInstanceOf(WipLimitReached);
  });

  it("leaves the mission parked when the limit refuses it", async () => {
    for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) missions.seed(ALICE, `Active ${i}`, "active");
    const parked = missions.seed(ALICE, "Waiting", "parked");

    await expect(unpark.execute(ALICE, parked.id)).rejects.toThrow();
    await expect(missions.findById(ALICE, parked.id)).resolves.toMatchObject({ status: "parked" });
  });

  it("reports the wrong status rather than the WIP limit for a non-parked mission", async () => {
    // Order matters for the message the user reads: a WIP-limit error here would
    // send them off to park something irrelevant to fix a problem that isn't that.
    for (let i = 0; i < MISSION_WIP_LIMIT; i += 1) missions.seed(ALICE, `Active ${i}`, "active");
    const active = missions.seed(ALICE, "Already going", "completed");

    await expect(unpark.execute(ALICE, active.id)).rejects.toBeInstanceOf(MissionNotParked);
  });

  it("rejects an unknown mission", async () => {
    await expect(
      unpark.execute(ALICE, "33333333-3333-4333-8333-333333333333"),
    ).rejects.toBeInstanceOf(MissionNotFound);
  });
});

describe("reads", () => {
  let missions: InMemoryMissions;

  beforeEach(() => {
    missions = new InMemoryMissions();
  });

  it("lists every mission when no status is given", async () => {
    missions.seed(ALICE, "Active one", "active");
    missions.seed(ALICE, "Parked one", "parked");

    const listed = await new ListMissions(missions).execute(ALICE, {});
    expect(listed.map((m) => m.fields.topic).sort()).toEqual(["Active one", "Parked one"]);
  });

  it("filters by status", async () => {
    missions.seed(ALICE, "Active one", "active");
    missions.seed(ALICE, "Parked one", "parked");

    const listed = await new ListMissions(missions).execute(ALICE, { status: "parked" });
    expect(listed.map((m) => m.fields.topic)).toEqual(["Parked one"]);
  });

  it("never lists another user's missions", async () => {
    missions.seed(BOB, "Bob's mission", "active");
    await expect(new ListMissions(missions).execute(ALICE, {})).resolves.toEqual([]);
  });

  it("gets one mission", async () => {
    const mission = missions.seed(ALICE, "Rust", "active");
    await expect(new GetMission(missions).execute(ALICE, mission.id)).resolves.toMatchObject({
      id: mission.id,
    });
  });

  it("reports a missing mission rather than returning null", async () => {
    await expect(
      new GetMission(missions).execute(ALICE, "33333333-3333-4333-8333-333333333333"),
    ).rejects.toBeInstanceOf(MissionNotFound);
  });
});
