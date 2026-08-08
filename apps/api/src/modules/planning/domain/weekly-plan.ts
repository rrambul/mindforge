import type { IsoDate, PlanSubject } from "@mindforge/core";
import { DuplicatePlanSubject } from "./errors.js";
import { subjectKey } from "./plan-subject.js";

/** Target minutes against one subject for one week (FR-F5). */
export interface PlannedAllocation {
  readonly subject: PlanSubject;
  readonly plannedMinutes: number;
}

export interface WeeklyPlanSnapshot {
  readonly id: string;
  readonly userId: string;
  /** Already normalised to the user's week start — see `PutWeeklyPlan`. */
  readonly weekStart: IsoDate;
  readonly allocations: readonly PlannedAllocation[];
}

/**
 * A week's intentions.
 *
 * The aggregate is the *set*, not the row: `PutWeeklyPlanSchema` explains why the API replaces a
 * whole week at once, and the same reasoning is what makes the allocations part of this object
 * rather than rows edited on their own. Two independent writes can land in either order and leave the
 * week over-allocated in between; one value cannot.
 *
 * There is no `now` and no `updatedAt` here. Nothing in a plan is a fact about *when* — the week is
 * the week, the minutes are minutes — and `weekly_plans.updated_at` exists for the database's own
 * bookkeeping rather than for anything this aggregate reasons about.
 */
export class WeeklyPlan {
  private constructor(
    readonly id: string,
    readonly userId: string,
    readonly weekStart: IsoDate,
    private allocationsValue: readonly PlannedAllocation[],
  ) {}

  /** A week nobody has planned yet. Given an id up front, because saving it is the next thing. */
  static forWeek(input: { id: string; userId: string; weekStart: IsoDate }): WeeklyPlan {
    return new WeeklyPlan(input.id, input.userId, input.weekStart, []);
  }

  static fromSnapshot(snapshot: WeeklyPlanSnapshot): WeeklyPlan {
    return new WeeklyPlan(snapshot.id, snapshot.userId, snapshot.weekStart, snapshot.allocations);
  }

  get allocations(): readonly PlannedAllocation[] {
    return this.allocationsValue;
  }

  /** What the week adds up to. Derived on read, never stored (non-negotiable 2). */
  get plannedTotal(): number {
    return this.allocationsValue.reduce((sum, a) => sum + a.plannedMinutes, 0);
  }

  /**
   * Replaces the whole set, and refuses a set the database would refuse.
   *
   * In memory only — the repository is the write. That is deliberate, so a caller can validate a
   * candidate week against every rule here before anything is persisted, and a rejected plan leaves
   * the stored one exactly as it was.
   */
  replaceAllocations(allocations: readonly PlannedAllocation[]): void {
    const seen = new Set<string>();

    for (const allocation of allocations) {
      // A `RangeError` rather than a `DomainError`, following `Resource`: `AllocationSchema` caps the
      // minutes at 1..MAX_PLANNED_MINUTES, so no request can reach this and there is no user to
      // translate a message for. It is here because `planned_minutes > 0` is a constraint on the
      // table, and a zero-minute allocation is the absence of an allocation wearing a row.
      if (!Number.isInteger(allocation.plannedMinutes) || allocation.plannedMinutes < 1) {
        throw new RangeError(`plannedMinutes must be a positive integer`);
      }

      const key = subjectKey(allocation.subject);
      if (seen.has(key)) throw new DuplicatePlanSubject(allocation.subject);
      seen.add(key);
    }

    // Copied, so a caller that keeps mutating the array it handed in cannot edit a saved plan.
    this.allocationsValue = [...allocations];
  }

  toSnapshot(): WeeklyPlanSnapshot {
    return {
      id: this.id,
      userId: this.userId,
      weekStart: this.weekStart,
      allocations: this.allocationsValue,
    };
  }
}
