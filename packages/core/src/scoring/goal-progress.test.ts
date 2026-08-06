import { describe, expect, it } from "vitest";
import { MEASURABLE_KINDS_M1, TARGET_KINDS, type TargetDefinition } from "../schemas/goal.js";
import { goalProgress, targetProgress, type WeightedTarget } from "./goal-progress.js";

const RESOURCE = "11111111-1111-4111-8111-111111111111";
const SKILL = "22222222-2222-4222-8222-222222222222";
const MISSION = "33333333-3333-4333-8333-333333333333";

/** One target of each kind, so a test can iterate all seven. */
const SAMPLE: Readonly<Record<string, TargetDefinition>> = {
  resource_progress: {
    kind: "resource_progress",
    resourceId: RESOURCE,
    target: { percent: 100 },
  },
  skill_band: { kind: "skill_band", skillId: SKILL, target: { band: "fluent" } },
  artifact: { kind: "artifact", target: {} },
  focus_hours: { kind: "focus_hours", missionId: MISSION, target: { hours: 40 } },
  review_accuracy: {
    kind: "review_accuracy",
    skillId: SKILL,
    target: { accuracy: 0.85, windowDays: 30 },
  },
  lessons_completed: {
    kind: "lessons_completed",
    missionId: MISSION,
    target: { count: 10 },
  },
  manual: { kind: "manual", target: {} },
};

function weighted(definition: TargetDefinition, weight = 1, evidence = {}): WeightedTarget {
  return { definition, weight, evidence };
}

describe("the honesty rule", () => {
  it("never reports 0 for something it cannot measure", () => {
    // The rule the whole module exists for. "No progress" and "cannot be measured" are different
    // claims, and a 0% bar for the second is a discouraging lie about work the user may have done.
    for (const kind of TARGET_KINDS) {
      if (kind === "manual") continue;
      const progress = targetProgress(SAMPLE[kind]!, {});
      expect(progress.fraction, kind).toBeNull();
      expect(progress.unmeasurable, kind).not.toBeNull();
    }
  });

  it("says which kind of unmeasurable it is", () => {
    // "No data yet" is about the user's evidence; "not implemented" is about the app. Collapsing them
    // would tell someone to go and read a book to fix a missing feature.
    expect(targetProgress(SAMPLE["resource_progress"]!, {}).unmeasurable).toBe("no_data");
    expect(targetProgress(SAMPLE["artifact"]!, {}).unmeasurable).toBe("not_yet_implemented");
  });

  it("takes its reason from MEASURABLE_KINDS_M1 rather than a second copy", () => {
    // The reason is not derivable from the evidence — a null skill score looks the same whether
    // scoring is unbuilt or the user is unassessed — so one list decides, and this checks it is the
    // one being consulted.
    for (const kind of TARGET_KINDS) {
      if (kind === "manual") continue;
      const reason = targetProgress(SAMPLE[kind]!, {}).unmeasurable;
      expect(reason, kind).toBe(
        MEASURABLE_KINDS_M1.includes(kind) ? "no_data" : "not_yet_implemented",
      );
    }
  });

  it("measures a kind the moment its source appears, without this file changing", () => {
    // `artifact` is not in M1's list, but supplied with real data it is measured anyway — otherwise
    // the day artifacts ship, goals would keep reading as unmeasurable until someone remembered this.
    const progress = targetProgress(SAMPLE["artifact"]!, { satisfied: true });
    expect(progress.fraction).toBe(1);
    expect(progress.met).toBe(true);
  });

  it("never treats an unmeasurable target as met", () => {
    // Otherwise a goal completes itself by containing something the system cannot check.
    for (const kind of TARGET_KINDS) {
      if (kind === "manual") continue;
      expect(targetProgress(SAMPLE[kind]!, {}).met, kind).toBe(false);
    }
  });
});

describe("resource_progress", () => {
  it("scales the resource's own fraction against the target percent", () => {
    // "Finish it to 80%" is met at 80%, so being 40% through is halfway to the goal, not 40% of it.
    const target: TargetDefinition = {
      kind: "resource_progress",
      resourceId: RESOURCE,
      target: { percent: 80 },
    };
    expect(targetProgress(target, { resourceFraction: 0.4 }).fraction).toBeCloseTo(0.5);
    expect(targetProgress(target, { resourceFraction: 0.8 }).met).toBe(true);
  });

  it("does not exceed 1 when you read past the target", () => {
    const target: TargetDefinition = {
      kind: "resource_progress",
      resourceId: RESOURCE,
      target: { percent: 50 },
    };
    expect(targetProgress(target, { resourceFraction: 1 }).fraction).toBe(1);
  });

  it("is unmeasurable when the resource's own fraction is unknown", () => {
    // A book whose length was never recorded has a position but no fraction, and 0% of a book you
    // are 137 pages into is false.
    expect(
      targetProgress(SAMPLE["resource_progress"]!, { resourceFraction: null }).fraction,
    ).toBeNull();
  });

  it("reports a genuine zero as zero", () => {
    // Unlike the case above: 0% of a book with a known length is a fact.
    const progress = targetProgress(SAMPLE["resource_progress"]!, { resourceFraction: 0 });
    expect(progress.fraction).toBe(0);
    expect(progress.unmeasurable).toBeNull();
  });
});

describe("skill_band (FR-M3b)", () => {
  const target: TargetDefinition = {
    kind: "skill_band",
    skillId: SKILL,
    target: { band: "fluent" },
  };

  it("measures the ordinal distance from where the goal started", () => {
    // aware → fluent is three bands. Reaching `working` is two of them.
    expect(targetProgress(target, { skillScore: 55, bandAtStart: "aware" }).fraction).toBeCloseTo(
      2 / 3,
    );
  });

  it("is met when the decayed score sits in the target band", () => {
    expect(targetProgress(target, { skillScore: 75, bandAtStart: "aware" }).met).toBe(true);
  });

  it("un-meets itself when the skill fades", () => {
    // The point of FR-M3b, and the reason this reads the decayed score rather than a stored high
    // water mark: a goal you met and then let rot is not a goal you have met.
    expect(targetProgress(target, { skillScore: 75, bandAtStart: "aware" }).met).toBe(true);
    expect(targetProgress(target, { skillScore: 55, bandAtStart: "aware" }).met).toBe(false);
  });

  it("is unmeasurable for a skill with no score", () => {
    // A null score is unproven, which is not the same as the lowest band — the distinction `bandFor`
    // exists to preserve, and flattening it here would undo it.
    //
    // The reason is `not_yet_implemented` rather than `no_data` because in M1 there is nothing the
    // user can do about it: scores come from assessments and reviews, which land in M2. Saying "no
    // data yet" would imply an action that does not exist.
    expect(targetProgress(target, { skillScore: null }).unmeasurable).toBe("not_yet_implemented");
  });

  it("measures it the moment a score exists, so M2 needs no change here", () => {
    expect(targetProgress(target, { skillScore: 55, bandAtStart: "aware" }).fraction).toBeCloseTo(
      2 / 3,
    );
  });

  it("does not divide by zero when the goal started at the target band", () => {
    // A goal written down for something you were already fluent in. Odd, and it must not produce NaN.
    const progress = targetProgress(target, { skillScore: 75, bandAtStart: "fluent" });
    expect(progress.fraction).toBe(1);
    expect(Number.isNaN(progress.fraction)).toBe(false);
  });

  it("clamps at 0 when the skill went backwards from the start", () => {
    // Started at `working`, now `aware`. Negative progress is honest but a negative *fraction* is not
    // renderable, so it clamps and stays unmet.
    const progress = targetProgress(target, { skillScore: 10, bandAtStart: "working" });
    expect(progress.fraction).toBe(0);
    expect(progress.met).toBe(false);
  });

  it("shows no progress when the goal started above the band and has decayed below it", () => {
    // A goal to reach `fluent`, written when you were already `teaching`, now decayed to `aware`. A
    // full bar on an unmet target would contradict itself on screen.
    const progress = targetProgress(target, { skillScore: 10, bandAtStart: "teaching" });
    expect(progress.met).toBe(false);
    expect(progress.fraction).toBe(0);
  });

  it("measures from the current band when no start was recorded", () => {
    // A target added to an existing goal, where nobody captured where it began. Falling back to the
    // current band reports no progress rather than dividing by an unknown.
    const progress = targetProgress(target, { skillScore: 55 });
    expect(progress.fraction).toBe(0);
    expect(progress.met).toBe(false);
  });
});

describe("focus_hours", () => {
  const target: TargetDefinition = {
    kind: "focus_hours",
    missionId: MISSION,
    target: { hours: 40 },
  };

  it("converts logged minutes to hours against the target", () => {
    expect(targetProgress(target, { focusMinutes: 600 }).fraction).toBeCloseTo(0.25);
    expect(targetProgress(target, { focusMinutes: 2_400 }).met).toBe(true);
  });

  it("treats zero minutes as real data, not as missing", () => {
    // No sessions logged genuinely means no hours spent — unlike an unknown book length, there is
    // nothing unknown here.
    const progress = targetProgress(target, { focusMinutes: 0 });
    expect(progress.fraction).toBe(0);
    expect(progress.unmeasurable).toBeNull();
  });
});

describe("the kinds whose sources land later", () => {
  // Written now and tested now. The derivations exist so that when reviews and lessons ship, goal
  // progress starts moving without this file being touched — which is only true if it works.

  it("scales review accuracy against the target", () => {
    const target: TargetDefinition = {
      kind: "review_accuracy",
      skillId: SKILL,
      target: { accuracy: 0.8, windowDays: 30 },
    };
    expect(targetProgress(target, { reviewAccuracy: 0.4 }).fraction).toBeCloseTo(0.5);
    expect(targetProgress(target, { reviewAccuracy: 0.85 }).met).toBe(true);
  });

  it("counts completed lessons against the target", () => {
    const target: TargetDefinition = {
      kind: "lessons_completed",
      missionId: MISSION,
      target: { count: 10 },
    };
    expect(targetProgress(target, { lessonsCompleted: 4 }).fraction).toBeCloseTo(0.4);
    expect(targetProgress(target, { lessonsCompleted: 10 }).met).toBe(true);
    // More than asked for is still met, and still 100% rather than 120%.
    expect(targetProgress(target, { lessonsCompleted: 12 }).fraction).toBe(1);
  });

  it("treats a shipped artifact as done and an unshipped one as not", () => {
    expect(targetProgress(SAMPLE["artifact"]!, { satisfied: false }).met).toBe(false);
    expect(targetProgress(SAMPLE["artifact"]!, { satisfied: true }).met).toBe(true);
  });
});

describe("degenerate numbers", () => {
  it("does not render NaN or Infinity as a fraction", () => {
    // A bad row or a future caller doing arithmetic on a null would otherwise reach the UI as a bar
    // of width `NaN%`, which renders as an empty bar — a wrong number that looks like a real one.
    const target: TargetDefinition = {
      kind: "focus_hours",
      missionId: MISSION,
      target: { hours: 40 },
    };
    for (const minutes of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const fraction = targetProgress(target, { focusMinutes: minutes }).fraction;
      expect(Number.isFinite(fraction), String(minutes)).toBe(true);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });
});

describe("manual — the honest escape hatch", () => {
  it("is not met until it is set", () => {
    expect(targetProgress(SAMPLE["manual"]!, {}).met).toBe(false);
    expect(targetProgress(SAMPLE["manual"]!, {}).fraction).toBe(0);
  });

  it("is met when set", () => {
    expect(targetProgress(SAMPLE["manual"]!, { satisfied: true })).toEqual({
      fraction: 1,
      met: true,
      unmeasurable: null,
    });
  });

  it("is binary rather than a percentage, which is why it is not a hole in the rule", () => {
    // Without it, the only way to record a goal the system cannot measure is to fake a target it
    // can — strictly worse data than an honest checkbox.
    for (const satisfied of [true, false]) {
      expect([0, 1]).toContain(targetProgress(SAMPLE["manual"]!, { satisfied }).fraction);
    }
  });
});

describe("goalProgress", () => {
  it("says nothing rather than 0% for a goal with no targets", () => {
    // §3.8. Either number would be a made-up claim, and the absence is the nudge to add a target.
    const progress = goalProgress([]);
    expect(progress.fraction).toBeNull();
    expect(progress.met).toBe(false);
    expect(progress.targetCount).toBe(0);
  });

  it("takes the weighted mean of what it can measure", () => {
    const progress = goalProgress([
      weighted(SAMPLE["focus_hours"]!, 3, { focusMinutes: 2_400 }),
      weighted(SAMPLE["manual"]!, 1, {}),
    ]);
    // (3 × 1 + 1 × 0) / 4
    expect(progress.fraction).toBeCloseTo(0.75);
  });

  it("reports how much of the weight the number actually covers", () => {
    // A mean over half the weight presented as *the* progress is not wrong, it is just not the whole
    // claim it appears to be — so the UI is given what it needs to say "measuring 1 of 2".
    const progress = goalProgress([
      weighted(SAMPLE["focus_hours"]!, 1, { focusMinutes: 1_200 }),
      weighted(SAMPLE["artifact"]!, 1, {}),
    ]);

    expect(progress.measuredWeight).toBe(1);
    expect(progress.totalWeight).toBe(2);
    expect(progress.fraction).toBeCloseTo(0.5);
  });

  it("is unmeasurable when it has targets but none has a source", () => {
    // The number would be about the app's completeness rather than the user's work.
    const progress = goalProgress([weighted(SAMPLE["artifact"]!), weighted(SAMPLE["skill_band"]!)]);
    expect(progress.fraction).toBeNull();
    expect(progress.targetCount).toBe(2);
  });

  it("is met only when every target is met, including the ones it cannot measure", () => {
    const partly = goalProgress([
      weighted(SAMPLE["focus_hours"]!, 1, { focusMinutes: 2_400 }),
      weighted(SAMPLE["artifact"]!, 1, {}),
    ]);
    // The measurable half is complete and the goal is still not met, because an unmeasurable target
    // is not a met one.
    expect(partly.fraction).toBe(1);
    expect(partly.met).toBe(false);

    const fully = goalProgress([
      weighted(SAMPLE["focus_hours"]!, 1, { focusMinutes: 2_400 }),
      weighted(SAMPLE["manual"]!, 1, { satisfied: true }),
    ]);
    expect(fully.met).toBe(true);
  });

  it("weights nothing to death — a zero-weight target cannot be created", () => {
    // Guarded by the schema rather than here, but the mean must still behave if one arrived.
    const progress = goalProgress([weighted(SAMPLE["manual"]!, 1, { satisfied: true })]);
    expect(progress.fraction).toBe(1);
  });
});
