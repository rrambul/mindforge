import type { MissionFields } from "@mindforge/core";
import { describe, expect, it } from "vitest";
import { MissionNotActive, MissionNotParked } from "./errors.js";
import { Mission, UNSPECIFIED_REASON, type MissionSnapshot } from "./mission.js";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-05T12:00:00Z");
const LATER = new Date("2026-08-06T09:30:00Z");

const FIELDS: MissionFields = {
  topic: "Rust ownership",
  why: "I keep fighting the borrow checker",
  successLooksLike: "I can explain lifetimes without looking it up",
  constraints: "Evenings only",
  currentLevel: "Read half the book",
};

function newMission(overrides: Partial<MissionFields> = {}): Mission {
  return Mission.create({ id: ID, userId: USER, fields: { ...FIELDS, ...overrides }, now: NOW });
}

function snapshotOf(overrides: Partial<MissionSnapshot> = {}): MissionSnapshot {
  return {
    id: ID,
    userId: USER,
    status: "active",
    workspaceKey: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...FIELDS,
    ...overrides,
  };
}

describe("Mission.create", () => {
  it("starts active, because a mission is created to be worked on", () => {
    // There is no draft state in this product, and adding one would be the first
    // step towards a backlog of intentions you never look at.
    expect(newMission().status).toBe("active");
  });

  it("does not assign a workspace key", () => {
    // The key is set once, when the teach workspace is first materialised (M3).
    // Minting it at creation would make renaming a mission move files.
    expect(newMission().workspaceKey).toBeNull();
  });

  it("stamps both timestamps from the injected clock", () => {
    const mission = newMission();
    expect(mission.createdAt).toEqual(NOW);
    expect(mission.updatedAt).toEqual(NOW);
  });

  it.each(["", "   ", "\t\n"])("rejects a blank topic: %o", (topic) => {
    // Enforced in the entity, not only in the Zod schema. The schema guards one
    // entry point; seeds, the worker, and a future CLI import build missions too,
    // and a blank topic must be impossible from all of them.
    expect(() => newMission({ topic })).toThrow(RangeError);
  });
});

describe("Mission.fromSnapshot", () => {
  it("round-trips through toSnapshot", () => {
    const snapshot = snapshotOf({ status: "parked", workspaceKey: "missions/abc" });
    expect(Mission.fromSnapshot(snapshot).toSnapshot()).toEqual(snapshot);
  });

  it("re-checks invariants, because a row can be edited by hand", () => {
    expect(() => Mission.fromSnapshot(snapshotOf({ topic: "  " }))).toThrow(RangeError);
  });
});

describe("applyEdit", () => {
  it("returns null and touches nothing when the body changes no value", () => {
    // A history padded with no-op entries stops being readable, and "this mission
    // drifted eleven times" would become a claim about how often a form was
    // submitted rather than about the mission.
    const mission = newMission();
    expect(mission.applyEdit({ topic: FIELDS.topic }, "no real change", LATER)).toBeNull();
    expect(mission.updatedAt).toEqual(NOW);
  });

  it("returns null for an empty edit", () => {
    expect(newMission().applyEdit({}, null, LATER)).toBeNull();
  });

  it("records only the fields that moved, with their previous values", () => {
    const mission = newMission();
    const revision = mission.applyEdit({ topic: "Rust lifetimes" }, "narrowed scope", LATER);

    expect(revision).toEqual({
      missionId: ID,
      userId: USER,
      changedAt: LATER,
      reason: "narrowed scope",
      changed: ["topic"],
      previous: { topic: "Rust ownership" },
    });
    expect(mission.fields.topic).toBe("Rust lifetimes");
    expect(mission.updatedAt).toEqual(LATER);
  });

  it("records several fields in one revision", () => {
    const mission = newMission();
    const revision = mission.applyEdit(
      { topic: "Rust lifetimes", constraints: "Weekends too" },
      "replanned",
      LATER,
    );

    expect(revision?.changed).toEqual(["topic", "constraints"]);
    expect(revision?.previous).toEqual({
      topic: "Rust ownership",
      constraints: "Evenings only",
    });
  });

  it("distinguishes an omitted field from a cleared one", () => {
    // `undefined` means leave alone; `null` means clear. Collapsing them would make
    // it impossible to erase a `why` without a second endpoint.
    const mission = newMission();
    const revision = mission.applyEdit({ why: null }, null, LATER);

    expect(revision?.changed).toEqual(["why"]);
    expect(mission.fields.why).toBeNull();
    // Untouched.
    expect(mission.fields.constraints).toBe("Evenings only");
  });

  it("treats clearing an already-null field as no change", () => {
    const mission = newMission({ why: null });
    expect(mission.applyEdit({ why: null }, null, LATER)).toBeNull();
  });

  it("falls back to a marker when no reason is given", () => {
    // FR-M2 wants why it changed, but blocking an edit on a justification trains
    // you to type "update" forever. What changed and when is recorded either way,
    // and that is the drift signal.
    const mission = newMission();
    const revision = mission.applyEdit({ topic: "Rust lifetimes" }, null, LATER);
    expect(revision?.reason).toBe(UNSPECIFIED_REASON);
  });

  it("refuses to blank the topic through an edit", () => {
    const mission = newMission();
    expect(() => mission.applyEdit({ topic: "   " }, null, LATER)).toThrow(RangeError);
  });

  it("leaves the mission unchanged when an edit is rejected", () => {
    // A half-applied edit would be worse than a rejected one: the entity would be
    // saved in a state no rule allows.
    const mission = newMission();
    expect(() => mission.applyEdit({ topic: "  " }, null, LATER)).toThrow();
    expect(mission.fields.topic).toBe("Rust ownership");
    expect(mission.updatedAt).toEqual(NOW);
  });
});

describe("park and unpark", () => {
  it("parks an active mission", () => {
    const mission = newMission();
    mission.park(LATER);
    expect(mission.status).toBe("parked");
    expect(mission.updatedAt).toEqual(LATER);
  });

  it("unparks a parked mission", () => {
    const mission = Mission.fromSnapshot(snapshotOf({ status: "parked" }));
    mission.unpark(LATER);
    expect(mission.status).toBe("active");
  });

  it.each(["parked", "completed", "abandoned"] as const)(
    "refuses to park a mission that is %s",
    (status) => {
      const mission = Mission.fromSnapshot(snapshotOf({ status }));
      expect(() => mission.park(LATER)).toThrow(MissionNotActive);
    },
  );

  it.each(["active", "completed", "abandoned"] as const)(
    "refuses to unpark a mission that is %s",
    (status) => {
      const mission = Mission.fromSnapshot(snapshotOf({ status }));
      expect(() => mission.unpark(LATER)).toThrow(MissionNotParked);
    },
  );

  it("does not touch updatedAt when the transition is refused", () => {
    const mission = Mission.fromSnapshot(snapshotOf({ status: "parked" }));
    expect(() => mission.park(LATER)).toThrow();
    expect(mission.updatedAt).toEqual(NOW);
  });

  it("keeps content intact across parking", () => {
    // FR-M4b: parking is not archiving. Nothing about the mission itself changes.
    const mission = newMission();
    const before = mission.fields;
    mission.park(LATER);
    expect(mission.fields).toEqual(before);
  });
});
