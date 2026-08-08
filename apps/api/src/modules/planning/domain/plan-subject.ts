import type { PlanSubject } from "@mindforge/core";
import { AllocationNeedsOneSubject } from "./errors.js";

/**
 * A mission or a skill, as the one thing an allocation and a session are both about.
 *
 * `PlanSubject` itself lives in `packages/core` because `planVsActual` is written in terms of it.
 * What lives here is the pair of operations the API needs and that package cannot have: turning the
 * table's two nullable columns into one subject, and turning a subject into a map key.
 */

/**
 * The key every subject-shaped lookup in this module agrees on.
 *
 * A composite string rather than a nested map because both halves are needed to identify a row —
 * a mission and a skill can hold the same uuid in principle, and `planVsActual` keys its own maps
 * the same way. `:` is safe as a separator: uuids cannot contain one.
 */
export function subjectKey(subject: PlanSubject): string {
  return `${subject.kind}:${subject.id}`;
}

/**
 * The `num_nonnulls(mission_id, skill_id) = 1` check constraint, expressed as a constructor.
 *
 * Every path into this module comes through here, so an allocation that named both or neither cannot
 * exist as a value in the first place — which is what makes the rest of the module free to treat a
 * subject as a total thing rather than re-checking two nullable fields at every step.
 */
export function planSubjectFrom(
  missionId: string | null | undefined,
  skillId: string | null | undefined,
): PlanSubject {
  if (missionId != null && skillId == null) return { kind: "mission", id: missionId };
  if (skillId != null && missionId == null) return { kind: "skill", id: skillId };
  throw new AllocationNeedsOneSubject();
}
