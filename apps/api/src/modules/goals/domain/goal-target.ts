import {
  SUBJECT_FOR_KIND,
  targetProgress,
  type Band,
  type TargetDefinition,
  type TargetEvidence,
  type TargetKind,
  type TargetProgress,
} from "@mindforge/core";
import { TargetNotManual } from "./errors.js";

export interface GoalTargetSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly goalId: string;
  readonly definition: TargetDefinition;
  readonly weight: number;
  /**
   * When the target was last observed to be met.
   *
   * Stored rather than derived on read, and that is not a cache: it is *when* it happened, which no
   * amount of recomputation can recover later. Progress itself is always derived (§3.8) — this only
   * records the moment.
   */
  readonly metAt: Date | null;
  /** For `skill_band`: which band the skill was in when the target was set (§3.8). */
  readonly bandAtStart: Band | null;
}

/**
 * One typed target (FR-M3).
 *
 * The entity holds no progress field, and that absence is the design. Progress is a function of the
 * target plus the world's current evidence, so storing it would create a second version of the truth
 * that goes stale silently — and a stale progress number is exactly the dishonesty §3.8 forbids.
 */
export class GoalTarget {
  private metAtValue: Date | null;

  private constructor(
    readonly id: string,
    readonly userId: string,
    readonly goalId: string,
    readonly definition: TargetDefinition,
    readonly weight: number,
    metAt: Date | null,
    readonly bandAtStart: Band | null,
  ) {
    if (weight <= 0) throw new RangeError(`weight must be positive, received ${weight}`);
    this.metAtValue = metAt;
  }

  static create(input: {
    id: string;
    userId: string;
    goalId: string;
    definition: TargetDefinition;
    weight: number;
    /** Captured at creation, because §3.8 measures band distance from where the goal began. */
    bandAtStart?: Band | null;
  }): GoalTarget {
    return new GoalTarget(
      input.id,
      input.userId,
      input.goalId,
      input.definition,
      input.weight,
      null,
      input.bandAtStart ?? null,
    );
  }

  static fromSnapshot(snapshot: GoalTargetSnapshot): GoalTarget {
    return new GoalTarget(
      snapshot.id,
      snapshot.userId,
      snapshot.goalId,
      snapshot.definition,
      snapshot.weight,
      snapshot.metAt,
      snapshot.bandAtStart,
    );
  }

  get kind(): TargetKind {
    return this.definition.kind;
  }

  get metAt(): Date | null {
    return this.metAtValue;
  }

  /**
   * For a `manual` target, being met *is* the state — there is no second flag.
   *
   * Two columns encoding one fact eventually disagree, and the disagreement would surface as a target
   * that shows as done while the goal it belongs to says otherwise.
   */
  get manuallySatisfied(): boolean {
    return this.definition.kind === "manual" && this.metAtValue !== null;
  }

  /** Which entity this target points at, so a caller knows what to check exists. */
  get subjectId(): { subject: "resource" | "skill" | "mission"; id: string } | null {
    const subject = SUBJECT_FOR_KIND[this.definition.kind];
    if (subject === null) return null;

    const definition = this.definition;
    if (definition.kind === "resource_progress") return { subject, id: definition.resourceId };
    if (definition.kind === "skill_band" || definition.kind === "review_accuracy") {
      return { subject, id: definition.skillId };
    }
    if (definition.kind === "focus_hours" || definition.kind === "lessons_completed") {
      return { subject, id: definition.missionId };
    }
    return null;
  }

  /**
   * The honest escape hatch (§3.8), and the only setter here.
   *
   * Refused for every other kind rather than quietly ignored: a client that tries this is asking to
   * hand-enter a computed number, and silently accepting it would leave a self-reported value in a
   * field the UI renders as measured.
   */
  setManually(satisfied: boolean, now: Date): void {
    if (this.definition.kind !== "manual") throw new TargetNotManual(this.definition.kind);

    this.recordMet(satisfied, now);
  }

  /**
   * Recomputes from current evidence and stamps `metAt` when the answer changes.
   *
   * Called on any write that touches a source, and by the nightly job (§3.8). It returns the progress
   * so a caller does not compute it twice.
   */
  observe(evidence: TargetEvidence, now: Date): TargetProgress {
    const progress = targetProgress(this.definition, this.evidenceFrom(evidence));
    this.recordMet(progress.met, now);
    return progress;
  }

  /** Progress without recording anything — for reads. */
  progressGiven(evidence: TargetEvidence): TargetProgress {
    return targetProgress(this.definition, this.evidenceFrom(evidence));
  }

  /**
   * Folds in what only the target itself knows: whether a manual one is set, and the band it started
   * from.
   *
   * Public because the goal's weighted mean needs it too. It was private, and the result was that
   * `Goal.progress()` handed core's mean the raw evidence — so a manual target the user had ticked
   * read as unmet inside the goal while reading as met on its own row. Exactly the two-places-disagree
   * failure non-negotiable 3 is about, in miniature.
   */
  evidenceFrom(evidence: TargetEvidence): TargetEvidence {
    return {
      ...evidence,
      ...(this.definition.kind === "manual" ? { satisfied: this.manuallySatisfied } : {}),
      ...(this.bandAtStart === null ? {} : { bandAtStart: this.bandAtStart }),
    };
  }

  /**
   * Keeps `metAt` truthful in both directions.
   *
   * Cleared when a target stops being met — FR-M3b's whole point is that a `skill_band` goal can
   * un-meet itself, and a `met_at` left behind would let a rollup count a goal you no longer hold.
   * Not re-stamped while it stays met, because the date that matters is when it first happened.
   */
  private recordMet(met: boolean, now: Date): void {
    if (met && this.metAtValue === null) this.metAtValue = now;
    else if (!met) this.metAtValue = null;
  }

  toSnapshot(): GoalTargetSnapshot {
    return {
      id: this.id,
      userId: this.userId,
      goalId: this.goalId,
      definition: this.definition,
      weight: this.weight,
      metAt: this.metAtValue,
      bandAtStart: this.bandAtStart,
    };
  }
}
