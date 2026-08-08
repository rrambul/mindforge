import {
  MAX_PLANNED_MINUTES,
  type AllocationInput,
  type PutWeeklyPlanInput,
} from "@mindforge/core";
import type { LabelledPlanRow } from "../api/use-planning.js";
import { MAX_ALLOCATIONS } from "./allocation-draft.js";

/**
 * Reading a week (FR-F6).
 *
 * Pure functions over the rows the API already computed. Nothing here does arithmetic that
 * `planVsActual` in `packages/core` owns — no attainment is recomputed, no total re-summed — because
 * a review screen that disagreed with the API about how the week went would be worse than no review
 * screen. What this module does is *partition*: which rows are the ones worth a sentence.
 */

/**
 * The three kinds of row, which are three different facts and must not be one list.
 *
 * - **moved** — planned, and worked on. The delta says by how much you missed or overshot.
 * - **stalled** — planned, and not touched. Zero here is a measurement, not a gap in the data.
 * - **unplanned** — worked on without planning it. `plannedMinutes` and `attainment` are both null,
 *   and the row has no percentage at all: two hours against a plan of nothing is not 200%, not
 *   infinite, and not "over target".
 */
export interface WeekOutcome {
  readonly moved: readonly LabelledPlanRow[];
  readonly stalled: readonly LabelledPlanRow[];
  readonly unplanned: readonly LabelledPlanRow[];
}

export function splitOutcome(rows: readonly LabelledPlanRow[]): WeekOutcome {
  return {
    moved: rows.filter((row) => row.plannedMinutes !== null && row.actualMinutes > 0),
    stalled: rows.filter((row) => row.plannedMinutes !== null && row.actualMinutes === 0),
    unplanned: rows.filter((row) => row.plannedMinutes === null),
  };
}

export interface NextWeekProposal {
  /** What to prefill, largest first. Empty when the week produced nothing to carry forward. */
  readonly rows: readonly ProposedRow[];
  readonly body: PutWeeklyPlanInput;
  readonly totalMinutes: number;
  /**
   * Planned rows with no minutes against them, which are **not** carried forward.
   *
   * Named rather than silently dropped: zero cannot be allocated (`AllocationSchema` refuses it), so
   * a stalled row can only leave the plan or be re-entered by hand. Letting it disappear without a
   * word would look like the app deciding you had given up on it.
   */
  readonly dropped: readonly LabelledPlanRow[];
}

export interface ProposedRow {
  readonly key: string;
  readonly label: string | null;
  readonly minutes: number;
}

/**
 * Next week, prefilled from this week's actuals — the loop closing (FR-F6).
 *
 * **Actuals, not the old plan.** The number worth starting from is the one you demonstrated you can
 * hit, and re-offering a target you missed by half is how a plan becomes a list of aspirations you
 * stop reading. Unplanned work is included for the same reason: you did it, so it is real, and the
 * point of the ritual is to notice it rather than to keep it off the books.
 *
 * Bounded by the two limits the schema enforces, so the offer cannot produce a 422: minutes are
 * capped at `MAX_PLANNED_MINUTES`, and only the largest `MAX_ALLOCATIONS` rows are offered.
 */
export function proposeNextWeek(rows: readonly LabelledPlanRow[]): NextWeekProposal {
  const worked = rows
    .filter((row) => row.actualMinutes >= 1)
    .map((row) => ({
      row,
      minutes: Math.min(Math.round(row.actualMinutes), MAX_PLANNED_MINUTES),
    }))
    .sort(
      (a, b) =>
        b.minutes - a.minutes ||
        // Stable beyond minutes, so the same week never proposes two different orders.
        (a.row.label ?? "").localeCompare(b.row.label ?? "") ||
        a.row.subject.id.localeCompare(b.row.subject.id),
    )
    .slice(0, MAX_ALLOCATIONS);

  const allocations: AllocationInput[] = worked.map(({ row, minutes }) =>
    row.subject.kind === "mission"
      ? { missionId: row.subject.id, plannedMinutes: minutes }
      : { skillId: row.subject.id, plannedMinutes: minutes },
  );

  return {
    rows: worked.map(({ row, minutes }) => ({
      key: `${row.subject.kind}:${row.subject.id}`,
      label: row.label,
      minutes,
    })),
    body: { allocations },
    totalMinutes: worked.reduce((sum, entry) => sum + entry.minutes, 0),
    dropped: rows.filter((row) => row.plannedMinutes !== null && row.actualMinutes === 0),
  };
}
