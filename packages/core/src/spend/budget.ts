/**
 * What a learner's teaching has cost, and whether they may start another run
 * (FR-T8; TECH-DESIGN §8.6).
 *
 * `llm_calls` has recorded every model call since M3 — one row per deduplicated
 * message plus a `teach_overhead` row per model, reconciled so a run's rows sum to
 * its real bill. Nothing read them. The ledger answered no question, no total was
 * shown to anyone, and the only ceiling in the product was `MAX_BUDGET_USD` inside
 * a single run — so a learner with six missions had six times that in flight and
 * no limit at all across a week.
 *
 * The three rules that shape this file, all of them non-negotiable 10:
 *
 * 1. **An unpriced call is not a free call.** `cost_usd` is null when the model is
 *    not in the pricing table, and summing nulls as zero would report a run that
 *    cost real money as costing nothing. The count travels with the total and
 *    `atLeast` says the total is a floor, so the UI can render "at least $4.10"
 *    rather than a figure it cannot stand behind.
 *
 * 2. **Unmeasured spend never refuses a request.** The cap is compared against
 *    what is *known* to have been spent. Refusing on an estimate would mean
 *    telling a learner they had spent money we never priced — inventing a number
 *    to take something away, which is the worst version of this mistake.
 *
 * 3. **No cap is `null`, not a very large number.** A deployment that does not
 *    want a ceiling has one absent, and the UI says so. A cap of 999999 renders as
 *    a progress bar at 0%, which is a measurement claim about a limit nobody set.
 */

/** Rows from one window, already grouped by whether they could be priced. */
export interface SpendTally {
  /** Summed `cost_usd` over the calls that had one. */
  readonly usd: number;
  readonly pricedCalls: number;
  /** Calls whose model was not in the pricing table. Never folded into `usd`. */
  readonly unpricedCalls: number;
}

export interface BudgetStatus {
  /**
   * What is known to have been spent. A floor rather than a total whenever
   * `atLeast` is true.
   */
  readonly spentUsd: number;
  /** Null when this deployment sets no ceiling. */
  readonly capUsd: number | null;
  /** Null when there is no cap. Clamped at zero — an overshoot is not negative room. */
  readonly remainingUsd: number | null;
  /** Null when there is no cap, so the UI draws no bar rather than an empty one. */
  readonly fraction: number | null;
  readonly exhausted: boolean;
  readonly unpricedCalls: number;
  /** `spentUsd` is a lower bound: some calls in the window could not be priced. */
  readonly atLeast: boolean;
}

/** Six decimals, matching `llm_calls.cost_usd`'s `numeric(10, 6)`. */
export function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

export function emptyTally(): SpendTally {
  return { usd: 0, pricedCalls: 0, unpricedCalls: 0 };
}

/**
 * The window's spend against the ceiling, if there is one.
 *
 * A cap of zero is a real cap meaning "nothing more", not an absent one — hence
 * `null` for absent. It is the difference between a deployment that has switched
 * teaching off and one that never configured a limit, and the learner sees a
 * different sentence for each.
 */
export function budgetStatus(tally: SpendTally, capUsd: number | null): BudgetStatus {
  const spentUsd = roundUsd(Math.max(0, tally.usd));
  const atLeast = tally.unpricedCalls > 0;

  if (capUsd === null) {
    return {
      spentUsd,
      capUsd: null,
      remainingUsd: null,
      fraction: null,
      exhausted: false,
      unpricedCalls: tally.unpricedCalls,
      atLeast,
    };
  }

  const cap = Math.max(0, capUsd);

  return {
    spentUsd,
    capUsd: roundUsd(cap),
    // Clamped, because a run may legitimately finish past the ceiling: the check
    // happens before it starts and it cannot know what it will cost. Reporting
    // "-$1.20 remaining" would be arithmetic pretending to be a fact about money
    // owed.
    remainingUsd: roundUsd(Math.max(0, cap - spentUsd)),
    // A cap of zero has no fraction to draw — every spend is 0/0. Null rather than
    // 1, which would render as a full bar and imply something was measured.
    fraction: cap === 0 ? null : Math.min(1, spentUsd / cap),
    exhausted: spentUsd >= cap,
    unpricedCalls: tally.unpricedCalls,
    atLeast,
  };
}
