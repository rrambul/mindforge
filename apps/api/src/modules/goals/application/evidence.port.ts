import type { TargetEvidence } from "@mindforge/core";
import type { GoalTarget } from "../domain/goal-target.js";

export const GOAL_EVIDENCE = Symbol("GoalEvidence");

/**
 * Gathers what each target needs in order to be measured (§3.8).
 *
 * A port for two reasons. It reaches across module boundaries — a `resource_progress` target reads a
 * resource and a `focus_hours` target sums focus sessions — and a use case that talked to three
 * repositories directly would be untestable without all three. And the kinds it cannot answer yet
 * return nothing rather than zero, which is a decision worth being able to see in one place.
 *
 * The contract that matters: **an absent field means "unknown", never "none".** Returning `0` for a
 * source that does not exist would turn every unimplemented kind into a 0% bar, which is the one
 * thing §3.8 forbids.
 */
/**
 * One target, plus the moment its progress is measured from.
 *
 * `countFrom` exists because §3.8 defines `focus_hours` as "sum of focus minutes **since goal
 * start**". Without it the reader summed a mission's whole history, so a goal written down on a
 * mission you had already spent forty hours on was met the instant you created it — a number that
 * looks better than the underlying thing, which is what non-negotiable 10 rules out.
 *
 * A property of the *goal* rather than the target, so it is supplied by the caller (which holds the
 * aggregate) rather than stored a second time on each target.
 */
export interface EvidenceRequest {
  readonly target: GoalTarget;
  readonly countFrom: Date;
}

export interface GoalEvidenceReader {
  /**
   * Evidence for a batch of targets, keyed by target id.
   *
   * Batched rather than one call per target because a goals list with five goals of four targets is
   * twenty round trips otherwise — and this runs on every read of the screen.
   */
  read(
    userId: string,
    requests: readonly EvidenceRequest[],
  ): Promise<Readonly<Record<string, TargetEvidence>>>;
}
