import {
  DomainError,
  type DomainErrorKind,
  type FieldViolation,
  type PlanSubject,
  type ServerMessageKey,
} from "@mindforge/core";

/**
 * Planning an hour against something that is not there.
 *
 * `not_found` rather than `invalid`, unlike the near-identical errors in goals, resources and
 * friction: those attach a subject to a row that exists, so the bad id is a field of the request. Here
 * the allocation *is* the subject — a week planned against a mission you deleted has nothing left to
 * be about — and 404 is the answer that tells a stale tab to refetch rather than to fix a field.
 *
 * Checked rather than left to the foreign key, for the reason the other three give: a constraint
 * violation arrives from the driver as an opaque error and becomes a 500, and this is reachable just
 * by having the planning grid open in one tab while deleting a mission in another.
 */
export class PlanSubjectMissing extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "plan-subject-missing";
  readonly detailKey: ServerMessageKey = "error.planning.subject_missing";

  constructor(kind: PlanSubject["kind"], id: string) {
    super(`No ${kind} ${id}`);
  }
}

/**
 * Hours planned against a parked mission (§5.3, FR-M4b).
 *
 * `conflict` rather than `invalid`: the request is well formed and the mission is really yours — the
 * current state is what says no. Parking is a statement that you are not working on something, so
 * allocating time to it is a contradiction rather than a typo, and the fix is a decision (unpark it)
 * rather than a correction. That is exactly the distinction `DomainErrorKind` draws, and it is what
 * lets the SPA offer an *unpark* button on this and on nothing else.
 */
export class MissionParked extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "mission-parked";
  readonly detailKey: ServerMessageKey = "error.planning.mission_parked";

  constructor(id: string) {
    super(`Mission ${id} is parked`);
  }
}

/**
 * The same mission or skill allocated twice in one week.
 *
 * Caught here so the two partial unique indexes on `weekly_allocations` never have to. Left to
 * Postgres it is a driver-level error and therefore a 500 — "nothing you did caused this" about a
 * grid the user filled in — and the honest reading is the opposite: two rows for one subject would
 * silently sum, so a doubled target would look like a plan rather than like a bug.
 */
export class DuplicatePlanSubject extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "duplicate-plan-subject";
  readonly detailKey: ServerMessageKey = "error.planning.duplicate_subject";
  override readonly violations: readonly FieldViolation[];

  constructor(subject: PlanSubject) {
    super(`${subject.kind} ${subject.id} is allocated twice`);
    // Named `allocations` rather than `allocations.3.missionId`: the fault is in the set, not in any
    // one row, and pointing react-hook-form at the second occurrence would invite the user to fix the
    // copy that happens to be later in the array.
    this.violations = [{ field: "allocations", code: "duplicate", message: this.message }];
  }
}

/**
 * An allocation naming both a mission and a skill, or neither.
 *
 * The same invariant as the table's `num_nonnulls(mission_id, skill_id) = 1` check, stated in the
 * domain so the failure is a 422 rather than a Postgres exception. `AllocationSchema` already refines
 * it, so no HTTP request reaches this — but the schema is one of three ways into these use cases
 * (the rollup and the seeds are the others), and the invariant belongs to the aggregate rather than
 * to the wire format.
 *
 * It carries `error.validation_failed` because that is what it is: a malformed allocation, with no
 * more specific thing to say than which field is wrong. The three planning keys describe subjects
 * that are missing, parked, or repeated, and borrowing one of them would put a wrong sentence in
 * front of the user to avoid an honest generic one.
 */
export class AllocationNeedsOneSubject extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "allocation-needs-one-subject";
  readonly detailKey: ServerMessageKey = "error.validation_failed";
  override readonly violations: readonly FieldViolation[];

  constructor() {
    super("An allocation names exactly one mission or one skill");
    this.violations = [{ field: "missionId", code: "one_subject", message: this.message }];
  }
}
