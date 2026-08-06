import type { TargetDefinition } from "@mindforge/core";
import { describe, expect, it } from "vitest";
import { GoalAlreadyClosed, GoalNotClosed, TargetNotManual } from "./errors.js";
import { GoalTarget } from "./goal-target.js";
import { Goal } from "./goal.js";

const USER = "11111111-1111-4111-8111-111111111111";
const GOAL = "22222222-2222-4222-8222-222222222222";
const RESOURCE = "33333333-3333-4333-8333-333333333333";
const MISSION = "44444444-4444-4444-8444-444444444444";
const SKILL = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-08-06T12:00:00Z");
const LATER = new Date("2026-08-07T09:00:00Z");

function aGoal(): Goal {
  return Goal.create({
    id: GOAL,
    userId: USER,
    missionId: MISSION,
    title: "Understand ownership properly",
    definitionOfDone: "I can explain lifetimes without looking it up",
    targetDate: "2026-09-30",
    now: NOW,
  });
}

function target(definition: TargetDefinition, weight = 1, id = "t1"): GoalTarget {
  return GoalTarget.create({ id, userId: USER, goalId: GOAL, definition, weight });
}

const BOOK: TargetDefinition = {
  kind: "resource_progress",
  resourceId: RESOURCE,
  target: { percent: 100 },
};
const HOURS: TargetDefinition = {
  kind: "focus_hours",
  missionId: MISSION,
  target: { hours: 40 },
};
const MANUAL: TargetDefinition = { kind: "manual", target: {} };

describe("progress", () => {
  it("says nothing rather than 0% for a goal with no targets", () => {
    // §3.8. The absence is the nudge to add a target; a number would be invented.
    expect(aGoal().progress().fraction).toBeNull();
  });

  it("has no way to set progress at all", () => {
    // The rule the feature exists to protect. Asserted on the shape because a setter added later
    // would pass every other test in this file.
    const goal = aGoal() as unknown as Record<string, unknown>;
    for (const name of ["setProgress", "progressValue", "setFraction", "percent"]) {
      expect(goal[name], name).toBeUndefined();
    }
  });

  it("derives the weighted mean from its targets", () => {
    const goal = aGoal();
    goal.addTarget(target(HOURS, 3, "hours"));
    goal.addTarget(target(MANUAL, 1, "manual"));

    // 40 hours of 40, and an unset manual target.
    expect(goal.progress({ hours: { focusMinutes: 2_400 } }).fraction).toBeCloseTo(0.75);
  });

  it("agrees with its own targets about whether they are met", () => {
    // Regression: the goal's mean was handed the raw evidence rather than each target's, so a manual
    // target the user had ticked read as met on its own row and unmet inside the goal. Two views of
    // one fact disagreeing is the failure non-negotiable 3 is about.
    const goal = aGoal();
    goal.addTarget(target(MANUAL, 1, "manual"));
    goal.findTarget("manual")?.setManually(true, NOW);

    expect(goal.findTarget("manual")?.progressGiven({}).met).toBe(true);
    expect(goal.progress().met).toBe(true);
    expect(goal.progress().fraction).toBe(1);
  });

  it("carries a skill target's starting band into the mean", () => {
    // The other half of the same merge: without it the band distance would be measured from wherever
    // the skill is now, which is always zero progress.
    const goal = aGoal();
    goal.addTarget(
      GoalTarget.create({
        id: "band",
        userId: USER,
        goalId: GOAL,
        definition: { kind: "skill_band", skillId: SKILL, target: { band: "fluent" } },
        weight: 1,
        bandAtStart: "aware",
      }),
    );

    expect(goal.progress({ band: { skillScore: 55 } }).fraction).toBeCloseTo(2 / 3);
  });

  it("recomputes on every read rather than storing a number", () => {
    // The same goal, two different worlds. A stored value would have gone stale between them.
    const goal = aGoal();
    goal.addTarget(target(HOURS, 1, "hours"));

    expect(goal.progress({ hours: { focusMinutes: 600 } }).fraction).toBeCloseTo(0.25);
    expect(goal.progress({ hours: { focusMinutes: 1_200 } }).fraction).toBeCloseTo(0.5);
  });
});

describe("closing", () => {
  it("records a missed goal with the note that makes it worth keeping", () => {
    // FR-M3: a goal that is allowed to fail is a goal you will write down honestly next time.
    const goal = aGoal();
    goal.close("missed", "ran out of time before the deadline");

    expect(goal.status).toBe("missed");
    expect(goal.outcomeNote).toBe("ran out of time before the deadline");
  });

  it("does not close itself when every target is met", () => {
    // Closing is a decision a person makes. Auto-closing would rob them of the outcome note, and the
    // app's job is to say "every target is met — close it?" instead.
    const goal = aGoal();
    goal.addTarget(target(MANUAL, 1, "manual"));
    goal.findTarget("manual")?.setManually(true, NOW);

    expect(goal.progress().met).toBe(true);
    expect(goal.status).toBe("active");
  });

  it("refuses to close twice", () => {
    const goal = aGoal();
    goal.close("abandoned", "changed direction");
    expect(() => goal.close("met", null)).toThrow(GoalAlreadyClosed);
  });

  it("refuses an edit after closing, because the record is what happened", () => {
    const goal = aGoal();
    goal.close("missed", "no time");
    expect(() => goal.edit({ title: "Rewritten" })).toThrow(GoalAlreadyClosed);
    expect(goal.title).toBe("Understand ownership properly");
  });
});

describe("reopening", () => {
  it("is explicit, and clears the note that described the ending", () => {
    const goal = aGoal();
    goal.close("abandoned", "changed direction");
    goal.reopen();

    expect(goal.status).toBe("active");
    // The note said why it ended, and it did not end.
    expect(goal.outcomeNote).toBeNull();
  });

  it("refuses to reopen something that is not closed", () => {
    expect(() => aGoal().reopen()).toThrow(GoalNotClosed);
  });

  it("allows editing again once reopened", () => {
    const goal = aGoal();
    goal.close("missed", "no time");
    goal.reopen();
    goal.edit({ title: "Second attempt" });

    expect(goal.title).toBe("Second attempt");
  });
});

describe("editing", () => {
  it("refuses to blank the title", () => {
    const goal = aGoal();
    expect(() => goal.edit({ title: "   " })).toThrow(RangeError);
  });

  it("clears the target date and the mission when asked", () => {
    const goal = aGoal();
    goal.edit({ targetDate: null, missionId: null });

    expect(goal.targetDate).toBeNull();
    expect(goal.missionId).toBeNull();
  });

  it("keeps the day exactly as given, rather than as an instant", () => {
    // A target date is a day in the user's calendar. Round-tripping it through a Date would move it
    // for anyone west of UTC.
    expect(aGoal().targetDate).toBe("2026-09-30");
  });
});

describe("observe", () => {
  it("stamps metAt when a target becomes met", () => {
    const goal = aGoal();
    goal.addTarget(target(HOURS, 1, "hours"));

    expect(goal.observe({ hours: { focusMinutes: 2_400 } }, LATER)).toBe(true);
    expect(goal.findTarget("hours")?.metAt).toEqual(LATER);
  });

  it("clears metAt when a target stops being met (FR-M3b)", () => {
    // The whole point: a goal can un-meet itself, and a met_at left behind would let a rollup count a
    // goal you no longer hold.
    const goal = aGoal();
    goal.addTarget(
      target({ kind: "skill_band", skillId: SKILL, target: { band: "fluent" } }, 1, "band"),
    );

    goal.observe({ band: { skillScore: 75, bandAtStart: "aware" } }, NOW);
    expect(goal.findTarget("band")?.metAt).toEqual(NOW);

    goal.observe({ band: { skillScore: 55, bandAtStart: "aware" } }, LATER);
    expect(goal.findTarget("band")?.metAt).toBeNull();
  });

  it("does not re-stamp a target that was already met", () => {
    // The date that matters is when it first happened, not when it was last checked.
    const goal = aGoal();
    goal.addTarget(target(HOURS, 1, "hours"));

    goal.observe({ hours: { focusMinutes: 2_400 } }, NOW);
    goal.observe({ hours: { focusMinutes: 3_000 } }, LATER);

    expect(goal.findTarget("hours")?.metAt).toEqual(NOW);
  });

  it("reports whether anything moved, so an unchanged goal needs no write", () => {
    // This runs on every mutation that touches a source and nightly across every goal; most of the
    // time nothing has changed.
    const goal = aGoal();
    goal.addTarget(target(HOURS, 1, "hours"));

    expect(goal.observe({ hours: { focusMinutes: 600 } }, NOW)).toBe(false);
    expect(goal.observe({ hours: { focusMinutes: 2_400 } }, LATER)).toBe(true);
    expect(goal.observe({ hours: { focusMinutes: 2_500 } }, LATER)).toBe(false);
  });
});

describe("targets", () => {
  it("adds and removes them", () => {
    const goal = aGoal();
    goal.addTarget(target(BOOK, 1, "book"));
    expect(goal.targets).toHaveLength(1);

    goal.removeTarget("book");
    expect(goal.targets).toEqual([]);
  });

  it("refuses a weight of zero, which is a target that cannot count", () => {
    expect(() => target(MANUAL, 0)).toThrow(RangeError);
  });

  it("names the subject each kind points at", () => {
    expect(target(BOOK).subjectId).toEqual({ subject: "resource", id: RESOURCE });
    expect(target(HOURS).subjectId).toEqual({ subject: "mission", id: MISSION });
    expect(target(MANUAL).subjectId).toBeNull();
  });

  describe("the manual escape hatch", () => {
    it("is met exactly when it is set, with no second flag", () => {
      // `met_at` is the state. Two columns encoding one fact eventually disagree, and the
      // disagreement would show as a target marked done inside a goal that says otherwise.
      const manual = target(MANUAL);
      expect(manual.manuallySatisfied).toBe(false);

      manual.setManually(true, NOW);
      expect(manual.manuallySatisfied).toBe(true);
      expect(manual.metAt).toEqual(NOW);

      manual.setManually(false, LATER);
      expect(manual.manuallySatisfied).toBe(false);
      expect(manual.metAt).toBeNull();
    });

    it("refuses to set a computed target by hand", () => {
      // Silently accepting it would leave a self-reported value in a field the UI renders as measured.
      expect(() => target(BOOK).setManually(true, NOW)).toThrow(TargetNotManual);
      expect(() => target(HOURS).setManually(true, NOW)).toThrow(TargetNotManual);
    });
  });
});

describe("snapshots", () => {
  it("round-trips a goal and its targets", () => {
    const goal = aGoal();
    goal.addTarget(target(BOOK, 2, "book"));
    goal.close("met", null);

    const restored = Goal.fromSnapshot(goal.toSnapshot(), goal.targets);
    expect(restored.toSnapshot()).toEqual(goal.toSnapshot());
    expect(restored.targets[0]?.weight).toBe(2);
  });

  it("round-trips a target", () => {
    const original = target(BOOK, 1.5, "book");
    original.observe({ resourceFraction: 1 }, NOW);

    expect(GoalTarget.fromSnapshot(original.toSnapshot()).toSnapshot()).toEqual(
      original.toSnapshot(),
    );
  });
});
