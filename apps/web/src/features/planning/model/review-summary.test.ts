import { MAX_PLANNED_MINUTES } from "@mindforge/core";
import { describe, expect, it } from "vitest";
import type { LabelledPlanRow } from "../api/use-planning.js";
import { MAX_ALLOCATIONS } from "./allocation-draft.js";
import { proposeNextWeek, splitOutcome } from "./review-summary.js";

function planned(
  id: string,
  plannedMinutes: number,
  actualMinutes: number,
  label = id,
): LabelledPlanRow {
  return {
    subject: { kind: "mission", id },
    plannedMinutes,
    actualMinutes,
    deltaMinutes: actualMinutes - plannedMinutes,
    attainment: plannedMinutes === 0 ? null : actualMinutes / plannedMinutes,
    label,
  };
}

function unplanned(id: string, actualMinutes: number, label: string | null = id): LabelledPlanRow {
  return {
    subject: { kind: "skill", id },
    plannedMinutes: null,
    actualMinutes,
    deltaMinutes: null,
    attainment: null,
    label,
  };
}

describe("splitOutcome", () => {
  it("keeps the three kinds of row apart", () => {
    // They are three different facts. "Planned and untouched" is a measurement; "worked on without
    // planning it" is not a shortfall at all, and one list would flatten both into a table of rows.
    const rows = [planned("a", 120, 90), planned("b", 60, 0), unplanned("c", 45)];
    const outcome = splitOutcome(rows);

    expect(outcome.moved.map((row) => row.subject.id)).toEqual(["a"]);
    expect(outcome.stalled.map((row) => row.subject.id)).toEqual(["b"]);
    expect(outcome.unplanned.map((row) => row.subject.id)).toEqual(["c"]);
  });

  it("counts an over-attained row as moved rather than as its own thing", () => {
    // Hitting a target and doubling it are both "it moved". Which of the two it was is the delta's
    // job to say, and a separate bucket would be the app grading the week.
    expect(splitOutcome([planned("a", 60, 240)]).moved).toHaveLength(1);
  });
});

describe("proposeNextWeek", () => {
  it("prefills from actuals, not from the plan that missed", () => {
    const proposal = proposeNextWeek([planned("a", 240, 90)]);

    expect(proposal.body.allocations).toEqual([{ missionId: "a", plannedMinutes: 90 }]);
    expect(proposal.totalMinutes).toBe(90);
  });

  it("carries unplanned work forward, because you did it", () => {
    // The point of the ritual is to notice the hours that went somewhere you never wrote down, not
    // to keep them off the books for another week.
    const proposal = proposeNextWeek([unplanned("s1", 120)]);

    expect(proposal.body.allocations).toEqual([{ skillId: "s1", plannedMinutes: 120 }]);
  });

  it("drops a planned row with no minutes, and names it", () => {
    // Zero is not an allocation — the schema refuses it — so a stalled row can only leave the plan.
    // Letting it disappear without a word would look like the app deciding you had given up.
    const proposal = proposeNextWeek([planned("a", 60, 0, "Rust")]);

    expect(proposal.body.allocations).toEqual([]);
    expect(proposal.dropped.map((row) => row.label)).toEqual(["Rust"]);
  });

  it("orders the offer by minutes, largest first", () => {
    const proposal = proposeNextWeek([planned("a", 10, 30), planned("b", 10, 120)]);

    expect(proposal.rows.map((row) => row.key)).toEqual(["mission:b", "mission:a"]);
  });

  it("cannot propose a week the server would refuse", () => {
    // Both bounds `PutWeeklyPlanSchema` enforces, so the offer never produces a 422 the user has no
    // way to act on: the per-row ceiling, and 50 allocations.
    const rows = [
      planned("huge", 1, MAX_PLANNED_MINUTES * 2),
      ...Array.from({ length: 60 }, (_, i) => planned(`m${i}`, 1, 10)),
    ];
    const proposal = proposeNextWeek(rows);

    expect(proposal.rows).toHaveLength(MAX_ALLOCATIONS);
    expect(proposal.rows[0]?.minutes).toBe(MAX_PLANNED_MINUTES);
  });

  it("offers nothing for a week with no minutes at all", () => {
    expect(proposeNextWeek([]).rows).toEqual([]);
  });
});
