import { describe, expect, it } from "vitest";
import { AllocationNeedsOneSubject, DuplicatePlanSubject } from "./errors.js";
import { planSubjectFrom, subjectKey } from "./plan-subject.js";
import { WeeklyPlan, type PlannedAllocation } from "./weekly-plan.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const MISSION = "33333333-3333-4333-8333-333333333333";
const SKILL = "44444444-4444-4444-8444-444444444444";
const WEEK = "2026-08-03";

function anEmptyPlan(): WeeklyPlan {
  return WeeklyPlan.forWeek({ id: PLAN, userId: ALICE, weekStart: WEEK });
}

describe("planSubjectFrom", () => {
  it("reads a mission allocation", () => {
    expect(planSubjectFrom(MISSION, null)).toEqual({ kind: "mission", id: MISSION });
  });

  it("reads a skill allocation", () => {
    expect(planSubjectFrom(null, SKILL)).toEqual({ kind: "skill", id: SKILL });
  });

  it("treats undefined and null the same, because the schema sends either", () => {
    expect(planSubjectFrom(MISSION, undefined)).toEqual({ kind: "mission", id: MISSION });
    expect(planSubjectFrom(undefined, SKILL)).toEqual({ kind: "skill", id: SKILL });
  });

  it("refuses an allocation naming both", () => {
    // The table's `num_nonnulls(mission_id, skill_id) = 1`, stated in the domain so the failure is a
    // 422 rather than a Postgres exception surfacing as a 500.
    expect(() => planSubjectFrom(MISSION, SKILL)).toThrow(AllocationNeedsOneSubject);
  });

  it("refuses an allocation naming neither", () => {
    expect(() => planSubjectFrom(null, null)).toThrow(AllocationNeedsOneSubject);
  });

  it("names the field, so the SPA can put the message beside it", () => {
    const error = new AllocationNeedsOneSubject();
    expect(error.kind).toBe("invalid");
    expect(error.violations.map((v) => v.field)).toEqual(["missionId"]);
  });
});

describe("subjectKey", () => {
  it("keeps a mission and a skill apart even if they shared an id", () => {
    expect(subjectKey({ kind: "mission", id: MISSION })).not.toBe(
      subjectKey({ kind: "skill", id: MISSION }),
    );
  });
});

describe("WeeklyPlan", () => {
  it("starts a never-planned week with nothing in it", () => {
    const plan = anEmptyPlan();
    expect(plan.allocations).toEqual([]);
    expect(plan.plannedTotal).toBe(0);
  });

  it("adds up what the week intends", () => {
    const plan = anEmptyPlan();
    plan.replaceAllocations([
      { subject: { kind: "mission", id: MISSION }, plannedMinutes: 300 },
      { subject: { kind: "skill", id: SKILL }, plannedMinutes: 120 },
    ]);

    expect(plan.plannedTotal).toBe(420);
  });

  it("replaces the whole set rather than merging into it", () => {
    // The reason it is a PUT: the grid is edited as a grid, and "you removed that row" has to be
    // expressible at all.
    const plan = anEmptyPlan();
    plan.replaceAllocations([
      { subject: { kind: "mission", id: MISSION }, plannedMinutes: 300 },
      { subject: { kind: "skill", id: SKILL }, plannedMinutes: 120 },
    ]);
    plan.replaceAllocations([{ subject: { kind: "skill", id: SKILL }, plannedMinutes: 60 }]);

    expect(plan.allocations).toEqual([
      { subject: { kind: "skill", id: SKILL }, plannedMinutes: 60 },
    ]);
    expect(plan.plannedTotal).toBe(60);
  });

  it("empties a week when everything is cleared", () => {
    const plan = anEmptyPlan();
    plan.replaceAllocations([{ subject: { kind: "mission", id: MISSION }, plannedMinutes: 300 }]);
    plan.replaceAllocations([]);

    expect(plan.allocations).toEqual([]);
  });

  it("refuses the same subject twice", () => {
    // Two rows for one subject would silently sum, so a doubled target would read as a plan rather
    // than as the bug it is — and left to the partial unique index it would be a 500.
    const plan = anEmptyPlan();

    expect(() =>
      plan.replaceAllocations([
        { subject: { kind: "mission", id: MISSION }, plannedMinutes: 300 },
        { subject: { kind: "mission", id: MISSION }, plannedMinutes: 60 },
      ]),
    ).toThrow(DuplicatePlanSubject);
  });

  it("allows a mission and a skill that happen to share an id", () => {
    const plan = anEmptyPlan();
    plan.replaceAllocations([
      { subject: { kind: "mission", id: MISSION }, plannedMinutes: 300 },
      { subject: { kind: "skill", id: MISSION }, plannedMinutes: 60 },
    ]);

    expect(plan.allocations).toHaveLength(2);
  });

  it("leaves the previous set intact when the new one is refused", () => {
    const plan = anEmptyPlan();
    plan.replaceAllocations([{ subject: { kind: "mission", id: MISSION }, plannedMinutes: 300 }]);

    expect(() =>
      plan.replaceAllocations([
        { subject: { kind: "skill", id: SKILL }, plannedMinutes: 60 },
        { subject: { kind: "skill", id: SKILL }, plannedMinutes: 60 },
      ]),
    ).toThrow(DuplicatePlanSubject);

    expect(plan.plannedTotal).toBe(300);
  });

  it("refuses a zero or fractional allocation, which the table refuses too", () => {
    const plan = anEmptyPlan();

    expect(() =>
      plan.replaceAllocations([{ subject: { kind: "skill", id: SKILL }, plannedMinutes: 0 }]),
    ).toThrow(RangeError);
    expect(() =>
      plan.replaceAllocations([{ subject: { kind: "skill", id: SKILL }, plannedMinutes: 1.5 }]),
    ).toThrow(RangeError);
  });

  it("cannot be edited through the array that was handed in", () => {
    const plan = anEmptyPlan();
    const mine: PlannedAllocation[] = [
      { subject: { kind: "mission", id: MISSION }, plannedMinutes: 300 },
    ];
    plan.replaceAllocations(mine);

    mine.push({ subject: { kind: "skill", id: SKILL }, plannedMinutes: 999 });

    expect(plan.allocations).toHaveLength(1);
  });

  it("round-trips through a snapshot, which is how a stored week comes back", () => {
    const plan = anEmptyPlan();
    plan.replaceAllocations([{ subject: { kind: "mission", id: MISSION }, plannedMinutes: 300 }]);

    const restored = WeeklyPlan.fromSnapshot(plan.toSnapshot());

    expect(restored.id).toBe(PLAN);
    expect(restored.userId).toBe(ALICE);
    expect(restored.weekStart).toBe(WEEK);
    expect(restored.plannedTotal).toBe(300);
  });
});

describe("DuplicatePlanSubject", () => {
  it("points at the set rather than at one row", () => {
    // The fault is that the set has two of something; naming `allocations.3.missionId` would invite
    // the user to fix whichever copy happened to be later in the array.
    const error = new DuplicatePlanSubject({ kind: "mission", id: MISSION });
    expect(error.kind).toBe("invalid");
    expect(error.violations.map((v) => v.field)).toEqual(["allocations"]);
  });
});
