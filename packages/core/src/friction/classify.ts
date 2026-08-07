/**
 * Friction classification — the product's central distinction.
 *
 * Deliberately deterministic, with no model call: a rule you can read beats an
 * LLM opinion you cannot audit, and this number drives the app's headline
 * metric. See TECH-DESIGN.md §9.3.
 *
 * This file owns the *rule*. Turning classified events into ember and slag
 * minutes is arithmetic with its own set of choices, and lives next door in
 * `split.ts`.
 */

export const FRICTION_TYPES = [
  "interruption",
  "self_interruption",
  "too_hard",
  "too_easy",
  "unclear_material",
  "tooling",
  "missing_prerequisite",
  "decision_fatigue",
  "avoidance",
  "physical",
  "productive_struggle",
] as const;

export type FrictionType = (typeof FRICTION_TYPES)[number];

export type FrictionClass = "productive" | "wasteful";

/** Always productive, regardless of how the session ended. */
const ALWAYS_PRODUCTIVE: ReadonlySet<FrictionType> = new Set(["productive_struggle"]);

/**
 * Productive only if the session still produced learning. "Too hard" that you
 * pushed through is desirable difficulty; "too hard" that ended the session is
 * a zone-of-proximal-development miss. Same event type, opposite meaning.
 */
const CONDITIONAL: ReadonlySet<FrictionType> = new Set(["too_hard", "missing_prerequisite"]);

export interface SessionOutcome {
  /** A learning record was written, or a review passed, after this event. */
  readonly producedLearning: boolean;
}

export function classifyFriction(type: FrictionType, outcome: SessionOutcome): FrictionClass {
  if (ALWAYS_PRODUCTIVE.has(type)) return "productive";
  if (CONDITIONAL.has(type) && outcome.producedLearning) return "productive";
  return "wasteful";
}
