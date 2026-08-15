import { describe, expect, it } from "vitest";

import { budgetStatus, emptyTally, roundUsd, type SpendTally } from "./budget.js";

function tally(overrides: Partial<SpendTally> = {}): SpendTally {
  return { ...emptyTally(), ...overrides };
}

describe("budgetStatus with a cap", () => {
  it("reports what is left", () => {
    const status = budgetStatus(tally({ usd: 4.5, pricedCalls: 12 }), 15);

    expect(status).toMatchObject({
      spentUsd: 4.5,
      capUsd: 15,
      remainingUsd: 10.5,
      exhausted: false,
      atLeast: false,
    });
    expect(status.fraction).toBeCloseTo(0.3, 10);
  });

  it("is exhausted exactly at the cap, not one cent past it", () => {
    expect(budgetStatus(tally({ usd: 15 }), 15).exhausted).toBe(true);
    expect(budgetStatus(tally({ usd: 14.999999 }), 15).exhausted).toBe(false);
  });

  it("clamps an overshoot rather than reporting negative room", () => {
    // A run is checked before it starts and cannot know what it will cost, so
    // finishing past the ceiling is normal. "-$2.50 remaining" would read as money
    // owed.
    const status = budgetStatus(tally({ usd: 17.5 }), 15);

    expect(status.remainingUsd).toBe(0);
    expect(status.fraction).toBe(1);
    expect(status.exhausted).toBe(true);
  });

  it("treats a cap of zero as a real ceiling with nothing to draw", () => {
    // Teaching switched off, which is different from teaching uncapped. Every
    // spend is 0/0, so there is no fraction — a full bar would claim a measurement.
    const status = budgetStatus(tally(), 0);

    expect(status.exhausted).toBe(true);
    expect(status.capUsd).toBe(0);
    expect(status.fraction).toBeNull();
  });

  it("refuses to let a negative cap invert the arithmetic", () => {
    const status = budgetStatus(tally({ usd: 1 }), -5);

    expect(status.capUsd).toBe(0);
    expect(status.remainingUsd).toBe(0);
    expect(status.exhausted).toBe(true);
  });
});

describe("budgetStatus with no cap", () => {
  it("draws no bar and never exhausts", () => {
    // Absent is not zero. A deployment that set no ceiling renders a sentence,
    // not a progress bar sitting at 0%.
    const status = budgetStatus(tally({ usd: 120 }), null);

    expect(status).toMatchObject({
      spentUsd: 120,
      capUsd: null,
      remainingUsd: null,
      fraction: null,
      exhausted: false,
    });
  });
});

describe("calls that could not be priced", () => {
  it("marks the total as a floor rather than folding them in as zero", () => {
    // `cost_usd` is null when the model is not in the pricing table. Summing that
    // as zero reports a run that cost real money as costing nothing.
    const status = budgetStatus(tally({ usd: 4.1, pricedCalls: 9, unpricedCalls: 3 }), 15);

    expect(status.spentUsd).toBe(4.1);
    expect(status.unpricedCalls).toBe(3);
    expect(status.atLeast).toBe(true);
  });

  it("does not let unmeasured spend exhaust the budget", () => {
    // Refusing on an estimate means telling someone they spent money nobody
    // priced. The cap answers to what is known.
    const status = budgetStatus(tally({ usd: 1, unpricedCalls: 500 }), 15);

    expect(status.exhausted).toBe(false);
    expect(status.remainingUsd).toBe(14);
  });

  it("is not a floor when everything priced", () => {
    expect(budgetStatus(tally({ usd: 2, pricedCalls: 4 }), 15).atLeast).toBe(false);
  });
});

describe("edges", () => {
  it("treats an empty window as zero spent, which is measured and true", () => {
    // The one place zero is honest: no calls means nothing was spent, and the
    // denominator exists. Unlike a module with no lessons, there is no unknown.
    expect(budgetStatus(emptyTally(), 15)).toMatchObject({
      spentUsd: 0,
      remainingUsd: 15,
      fraction: 0,
      exhausted: false,
      atLeast: false,
    });
  });

  it("never reports negative spend, whatever the sum says", () => {
    expect(budgetStatus(tally({ usd: -0.5 }), 15).spentUsd).toBe(0);
  });

  it("rounds to the six decimals the column stores", () => {
    expect(roundUsd(0.1 + 0.2)).toBe(0.3);
    expect(budgetStatus(tally({ usd: 1.23456789 }), 15).spentUsd).toBe(1.234568);
  });
});
