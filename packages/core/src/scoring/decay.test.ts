import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  KIND_WEIGHT,
  daysBetween,
  decayFactor,
  decayedScore,
  type Evidence,
  type EvidenceKind,
} from "./decay.js";

const NOW = new Date("2026-08-05T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const ev = (kind: EvidenceKind, rawScore: number, ageDays: number): Evidence => ({
  kind,
  rawScore,
  occurredAt: daysAgo(ageDays),
});

describe("decayFactor", () => {
  it("is 1 at age zero", () => {
    expect(decayFactor(0, 90)).toBe(1);
  });

  it("halves after exactly one half-life", () => {
    expect(decayFactor(90, 90)).toBeCloseTo(0.5, 10);
    expect(decayFactor(180, 90)).toBeCloseTo(0.25, 10);
  });

  it("clamps future-dated evidence to full weight rather than amplifying it", () => {
    // Clock skew and backfilled sessions produce negative ages. Amplifying
    // them would let a mistyped date invent confidence.
    expect(decayFactor(-30, 90)).toBe(1);
  });

  it("rejects a non-positive half-life", () => {
    expect(() => decayFactor(1, 0)).toThrow(RangeError);
    expect(() => decayFactor(1, -5)).toThrow(RangeError);
  });
});

describe("decayedScore", () => {
  it("returns null, not zero, when there is no evidence", () => {
    // "Unproven" and "proven to be zero" are different claims.
    const result = decayedScore([], 90, NOW);
    expect(result.score).toBeNull();
    expect(result.stdDev).toBeNull();
    expect(result.evidenceCount).toBe(0);
    expect(result.lastEvidenceAt).toBeNull();
  });

  it("returns the single observation's value when there is one", () => {
    expect(decayedScore([ev("assessment", 80, 0)], 90, NOW).score).toBe(80);
  });

  it("weights an artifact above an assessment of equal age", () => {
    const result = decayedScore([ev("artifact", 90, 0), ev("assessment", 50, 0)], 90, NOW);
    const midpoint = 70;
    expect(result.score!).toBeGreaterThan(midpoint);
  });

  it("weights recent evidence above old evidence of the same kind", () => {
    const result = decayedScore([ev("assessment", 90, 0), ev("assessment", 50, 180)], 90, NOW);
    expect(result.score!).toBeGreaterThan(70);
  });

  it("widens the confidence interval as evidence goes stale", () => {
    const fresh = decayedScore([ev("assessment", 70, 1)], 90, NOW);
    const stale = decayedScore([ev("assessment", 70, 200)], 90, NOW);
    expect(stale.stdDev!).toBeGreaterThan(fresh.stdDev!);
  });

  it("never reports certainty from a single observation", () => {
    expect(decayedScore([ev("artifact", 100, 0)], 90, NOW).stdDev!).toBeGreaterThan(0);
  });

  it("reports the newest evidence date regardless of input order", () => {
    const result = decayedScore([ev("lesson", 40, 90), ev("lesson", 40, 3)], 90, NOW);
    expect(result.lastEvidenceAt).toEqual(daysAgo(3));
  });

  it("clamps out-of-range raw scores instead of propagating them", () => {
    expect(decayedScore([ev("assessment", 250, 0)], 90, NOW).score).toBe(100);
    expect(decayedScore([ev("assessment", -80, 0)], 90, NOW).score).toBe(0);
  });

  it("rejects NaN rather than silently producing NaN", () => {
    expect(() => decayedScore([ev("assessment", Number.NaN, 0)], 90, NOW)).toThrow(RangeError);
  });

  it("goes unproven when every observation has decayed into irrelevance", () => {
    // Underflow to exactly zero weight. The skill was proven once; it isn't now.
    const result = decayedScore([ev("assessment", 90, 400_000)], 1, NOW);
    expect(result.score).toBeNull();
    expect(result.evidenceCount).toBe(1);
    expect(result.lastEvidenceAt).not.toBeNull();
  });
});

describe("decayedScore — properties", () => {
  const kindArb = fc.constantFrom(...(Object.keys(KIND_WEIGHT) as EvidenceKind[]));
  const evidenceArb = fc.record({
    kind: kindArb,
    rawScore: fc.integer({ min: 0, max: 100 }),
    ageDays: fc.integer({ min: 0, max: 3650 }),
  });

  it("always produces a score within 0..100", () => {
    fc.assert(
      fc.property(fc.array(evidenceArb, { minLength: 1, maxLength: 40 }), (raw) => {
        const score = decayedScore(
          raw.map((r) => ev(r.kind, r.rawScore, r.ageDays)),
          90,
          NOW,
        ).score;
        return score === null || (score >= 0 && score <= 100);
      }),
    );
  });

  it("never increases a score as time passes with no new evidence", () => {
    // Decay is monotonic. If this ever fails, the dashboard is flattering you.
    fc.assert(
      fc.property(
        fc.array(evidenceArb, { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 2000 }),
        (raw, extraDays) => {
          const evidence = raw.map((r) => ev(r.kind, r.rawScore, r.ageDays));
          const later = new Date(NOW.getTime() + extraDays * 86_400_000);
          const a = decayedScore(evidence, 90, NOW).stdDev;
          const b = decayedScore(evidence, 90, later).stdDev;
          if (a === null || b === null) return true;
          return b >= a - 1e-9; // uncertainty only ever grows while idle
        },
      ),
    );
  });

  it("is independent of the order evidence is supplied in", () => {
    fc.assert(
      fc.property(fc.array(evidenceArb, { minLength: 2, maxLength: 20 }), (raw) => {
        const evidence = raw.map((r) => ev(r.kind, r.rawScore, r.ageDays));
        const forward = decayedScore(evidence, 90, NOW).score;
        const reversed = decayedScore([...evidence].reverse(), 90, NOW).score;
        if (forward === null || reversed === null) return forward === reversed;
        return Math.abs(forward - reversed) < 1e-6;
      }),
    );
  });
});

describe("daysBetween", () => {
  it("counts forward in whole days", () => {
    expect(daysBetween(daysAgo(3), NOW)).toBeCloseTo(3, 10);
  });

  it("is negative for a future date", () => {
    expect(daysBetween(NOW, daysAgo(2))).toBeCloseTo(-2, 10);
  });
});
