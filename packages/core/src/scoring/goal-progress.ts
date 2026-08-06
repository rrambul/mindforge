import { MEASURABLE_KINDS_M1, type TargetDefinition, type TargetKind } from "../schemas/goal.js";
import { bandFor, bandIndex, type Band } from "./bands.js";

/**
 * The §3.8 derivations, one per target kind.
 *
 * These live here rather than in the API because the API and the SPA must never disagree about a
 * number the user is looking at (non-negotiable 3): a gauge that reads 60% beside an API that says
 * 45% breaks the product's central promise more thoroughly than either number being wrong.
 *
 * The whole module is arranged around one distinction that a percentage cannot express on its own:
 * **"no progress" and "cannot be measured" are different claims.** A skill with no evidence is not a
 * skill at zero, and an artifact target in M1 — before artifacts exist — is not an unstarted one.
 * Both return `null`, and the caller is forced to render something honest.
 */

/**
 * What the world currently says about a target's subject.
 *
 * Every field is optional and every one may be null, because in M1 most of them have no source yet.
 * The shape is deliberately flat data rather than entities: this package cannot import a repository,
 * and a function that took a `Resource` would be a function the SPA could not call.
 */
export interface TargetEvidence {
  /** `resource_progress`: the fraction from `progressFraction`, already null when unknown. */
  readonly resourceFraction?: number | null;
  /** `skill_band`: the **decayed** score (FR-M3b), so a met goal can un-meet itself. */
  readonly skillScore?: number | null;
  /** `skill_band`: the band when the goal was created, which is where the distance is measured from. */
  readonly bandAtStart?: Band | null;
  /** `focus_hours`: minutes logged against the mission since the goal started. */
  readonly focusMinutes?: number | null;
  /** `review_accuracy`: rolling accuracy across the target's window, 0..1. */
  readonly reviewAccuracy?: number | null;
  /** `lessons_completed`: how many lessons in the mission are complete. */
  readonly lessonsCompleted?: number | null;
  /** `artifact` and `manual`: whether the binary condition holds. */
  readonly satisfied?: boolean | null;
}

export interface TargetProgress {
  /**
   * 0..1, or **null when it cannot be measured at all**.
   *
   * Never a number standing in for absent data. `0` here is a claim — "you have started and got
   * nowhere" — and making it the fallback would turn every unimplemented source into a discouraging
   * lie about work the user may well have done.
   */
  readonly fraction: number | null;
  readonly met: boolean;
  /** Why there is no fraction, so the UI can say which — rather than showing a shrug. */
  readonly unmeasurable: "no_data" | "not_yet_implemented" | null;
}

/**
 * Why a target has no number, when its evidence is absent.
 *
 * Which reason applies is **not derivable from the evidence**: a null skill score looks identical
 * whether scoring has not been built or the user has simply not been assessed. So the capability
 * list is the single source of truth, consulted here rather than duplicated per case — the two
 * drifting apart would put a target in the UI that can never move, or hide one that works.
 *
 * The evidence still wins when it is present. A kind absent from the list but supplied with real
 * data is measured, so this keeps working the day its source lands rather than needing this file
 * edited in the same commit.
 */
function absent(kind: TargetKind): TargetProgress {
  return {
    fraction: null,
    met: false,
    unmeasurable: MEASURABLE_KINDS_M1.includes(kind) ? "no_data" : "not_yet_implemented",
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * One target's progress.
 *
 * `manual` is here and is not a hole in the "never entered" rule: it is a *binary you set*, not a
 * percentage you invent. The honest escape hatch matters — without it, the only way to record a goal
 * the system cannot measure is to fake a target that it can, which is strictly worse data.
 */
export function targetProgress(
  target: TargetDefinition,
  evidence: TargetEvidence = {},
): TargetProgress {
  switch (target.kind) {
    case "resource_progress": {
      const fraction = evidence.resourceFraction ?? null;
      // Null rather than 0: a book whose length was never recorded has a position but no fraction,
      // and reporting 0% of a book you are 137 pages into is simply false.
      if (fraction === null) return absent(target.kind);

      const goal = target.target.percent / 100;
      return {
        fraction: clamp01(fraction / goal),
        met: fraction >= goal,
        unmeasurable: null,
      };
    }

    case "skill_band": {
      // FR-M3b: the *decayed* score, so this moves without the user doing anything — and a met goal
      // can un-meet itself when the skill fades. That is correct and is stated plainly.
      const current = bandFor(evidence.skillScore ?? null);
      if (current === null) return absent(target.kind);

      const wanted = bandIndex(target.target.band);
      const start = evidence.bandAtStart ?? null;
      // Where the journey started. Falling back to the current band makes an already-met target read
      // as met rather than as a division by zero.
      const from = start === null ? bandIndex(current) : bandIndex(start);
      const met = bandIndex(current) >= wanted;

      if (met) return { fraction: 1, met: true, unmeasurable: null };

      // Ordinal distance (§3.8), from where the goal started to where it aimed.
      const distance = wanted - from;
      // Reachable, and not a rounding case: a goal to reach `fluent`, written when you were already
      // `teaching` and since decayed to `aware`. There is no meaningful ground to have covered, and a
      // full bar on a target the line above just declared unmet would be a self-contradiction on
      // screen. Zero is the honest reading — you are below the band and going the wrong way.
      if (distance <= 0) return { fraction: 0, met: false, unmeasurable: null };

      return {
        fraction: clamp01((bandIndex(current) - from) / distance),
        met: false,
        unmeasurable: null,
      };
    }

    case "focus_hours": {
      const minutes = evidence.focusMinutes ?? null;
      // Zero here is real data, unlike a missing fraction: no sessions logged means no hours spent.
      if (minutes === null) return absent(target.kind);

      const hours = minutes / 60;
      return {
        fraction: clamp01(hours / target.target.hours),
        met: hours >= target.target.hours,
        unmeasurable: null,
      };
    }

    case "review_accuracy": {
      const accuracy = evidence.reviewAccuracy ?? null;
      if (accuracy === null) return absent(target.kind);
      return {
        fraction: clamp01(accuracy / target.target.accuracy),
        met: accuracy >= target.target.accuracy,
        unmeasurable: null,
      };
    }

    case "lessons_completed": {
      const done = evidence.lessonsCompleted ?? null;
      if (done === null) return absent(target.kind);
      return {
        fraction: clamp01(done / target.target.count),
        met: done >= target.target.count,
        unmeasurable: null,
      };
    }

    case "artifact": {
      const satisfied = evidence.satisfied ?? null;
      if (satisfied === null) return absent(target.kind);
      return { fraction: satisfied ? 1 : 0, met: satisfied, unmeasurable: null };
    }

    case "manual": {
      // Unset is genuinely "not done" rather than unknown — the only thing that sets it is the user.
      const satisfied = evidence.satisfied ?? false;
      return { fraction: satisfied ? 1 : 0, met: satisfied, unmeasurable: null };
    }
  }
}

export interface WeightedTarget {
  readonly definition: TargetDefinition;
  readonly weight: number;
  readonly evidence?: TargetEvidence;
}

export interface GoalProgress {
  /**
   * The weighted mean over the targets that *can* be measured — null when none can.
   *
   * §3.8: a goal with no targets shows "no targets — progress can't be measured" rather than 0% or
   * 100%. The same holds when it has targets and none of them has a source yet, and for the same
   * reason: the number would be about the system's completeness, not the user's work.
   */
  readonly fraction: number | null;
  /** True only when every target is met. A goal is not met on the strength of the measurable half. */
  readonly met: boolean;
  readonly targetCount: number;
  /**
   * How much of the goal's weight the fraction actually covers.
   *
   * Reported rather than hidden so the UI can say "measuring 2 of 3 targets". A mean over half the
   * weight presented as *the* progress is the quiet kind of dishonesty this product is against —
   * it is not wrong, it is just not the whole claim it appears to be.
   */
  readonly measuredWeight: number;
  readonly totalWeight: number;
}

export function goalProgress(targets: readonly WeightedTarget[]): GoalProgress {
  const results = targets.map((target) => ({
    weight: target.weight,
    progress: targetProgress(target.definition, target.evidence),
  }));

  const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
  // flatMap rather than filter: it narrows the fraction to a number, so the mean below needs no
  // `?? 0` fallback for a case the filter has already excluded — a branch that can never run is a
  // branch nobody can reason about.
  const measurable = results.flatMap((r) =>
    r.progress.fraction === null ? [] : [{ weight: r.weight, fraction: r.progress.fraction }],
  );
  const measuredWeight = measurable.reduce((sum, r) => sum + r.weight, 0);

  const fraction =
    measuredWeight === 0
      ? null
      : measurable.reduce((sum, r) => sum + r.weight * r.fraction, 0) / measuredWeight;

  return {
    fraction,
    // An unmeasurable target is not a met one, so a goal with one can never be met. Anything else
    // would let a goal complete itself by containing something the system cannot check.
    met: results.length > 0 && results.every((r) => r.progress.met),
    targetCount: results.length,
    measuredWeight,
    totalWeight,
  };
}
