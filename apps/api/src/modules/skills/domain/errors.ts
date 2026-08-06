import {
  DomainError,
  type DomainErrorKind,
  type FieldViolation,
  type ServerMessageKey,
} from "@mindforge/core";

export class SkillNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "skill-not-found";
  readonly detailKey: ServerMessageKey = "error.skill.not_found";

  constructor(id: string) {
    super(`Skill ${id} not found`);
  }
}

/**
 * The prerequisite graph is a DAG (FR-S1), and this is what keeps it one.
 *
 * A cycle is not untidy, it is unusable: every skill in the loop is blocked by itself, so the ZPD
 * recommendation has nothing to suggest and there is no order in which to render them. There is no
 * honest way to display one, so it is refused at write time rather than tolerated at read time.
 *
 * The slug is specific so the SPA can say something better than "conflict" — it knows which two skills
 * were involved and can offer to remove the edge that would close the loop.
 */
export class PrerequisiteCycle extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "prerequisite-cycle";
  readonly detailKey: ServerMessageKey = "error.skill.prerequisite_cycle";

  constructor(skillId: string, prereqId: string) {
    super(`${skillId} requiring ${prereqId} would create a cycle`);
  }
}

/** A skill cannot be its own prerequisite — the degenerate cycle, reached by a misclick. */
export class SelfPrerequisite extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "self-prerequisite";
  readonly detailKey: ServerMessageKey = "error.skill.self_prerequisite";

  constructor(skillId: string) {
    super(`${skillId} cannot require itself`);
  }
}

/**
 * Two skills with the same name.
 *
 * The slug is unique per user, so this is reachable and worth naming: "Rust" twice is almost always a
 * mistake, and the constraint violation would otherwise arrive as a 500.
 */
export class SkillNameTaken extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "skill-name-taken";
  readonly detailKey: ServerMessageKey = "error.skill.name_taken";
  override readonly violations: readonly FieldViolation[];

  constructor(name: string) {
    super(`A skill named ${name} already exists`);
    this.violations = [{ field: "name", code: "taken", message: this.message }];
  }
}
