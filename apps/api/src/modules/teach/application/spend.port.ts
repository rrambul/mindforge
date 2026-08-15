import type { SpendTally } from "@mindforge/core";

export const SPEND_READER = Symbol("SpendReader");

/**
 * What teaching has cost one learner over one window (FR-T8).
 *
 * `llm_calls` has recorded every model call since M3 and nothing ever read the
 * rows back: the reconciliation that makes a run's calls sum to its real bill —
 * the dedupe key, the `teach_overhead` residual — answered no question and
 * enforced no ceiling. This is the read side that was missing.
 *
 * **Two numbers, never one.** A call whose model is not in the pricing table has a
 * null `cost_usd`, and folding those into the sum as zero would report a run that
 * cost real money as costing nothing. The count comes back alongside the total so
 * `budgetStatus` can mark the total as a floor (non-negotiable 10).
 *
 * `userId` is a parameter, as everywhere: the worker holds a service-role
 * connection that bypasses RLS, and this signature is what stops a cross-user read
 * (non-negotiable 1).
 */
export interface SpendReader {
  /**
   * Every call between `from` (inclusive) and `to` (exclusive).
   *
   * Half-open because the caller passes a day's bounds derived from the learner's
   * timezone, and a closed upper bound would count a call made exactly at midnight
   * on both days.
   */
  inWindow(userId: string, from: Date, to: Date): Promise<SpendTally>;
}
