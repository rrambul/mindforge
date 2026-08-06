/**
 * Skill scoring, decay, and confidence.
 *
 * This file is the reason `packages/core` exists and is held to 100% coverage:
 * a bug here produces a confidently wrong number rather than a crash, and every
 * downstream decision — what to study, what to review, whether a goal is met —
 * reads from it.
 *
 * The API and the SPA both import these functions. If a gauge and the API ever
 * disagree about a score, the product's central promise is broken, so there is
 * exactly one implementation. See TECH-DESIGN.md §9.1.
 */

/** Evidence kinds, ordered by how much they prove. */
export const EVIDENCE_KINDS = [
  "artifact",
  "teach_back",
  "assessment",
  "review",
  "lesson",
  "self_report",
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * Shipping something beats answering questions about it, and saying you know
 * something proves almost nothing. Self-report is deliberately near-zero: it is
 * recorded for the calibration gap, not to move the score.
 */
export const KIND_WEIGHT: Readonly<Record<EvidenceKind, number>> = Object.freeze({
  artifact: 1.0,
  teach_back: 0.9,
  assessment: 0.8,
  review: 0.6,
  lesson: 0.35,
  self_report: 0.1,
});

export interface Evidence {
  readonly kind: EvidenceKind;
  /** 0–100 for this single observation. */
  readonly rawScore: number;
  readonly occurredAt: Date;
}

export interface SkillScore {
  /** 0–100. Null when there is no evidence — never 0, which would be a lie. */
  readonly score: number | null;
  /** Standard deviation. Widens as evidence ages, so `score ± 2σ` stays honest. */
  readonly stdDev: number | null;
  readonly evidenceCount: number;
  readonly lastEvidenceAt: Date | null;
}

const MS_PER_DAY = 86_400_000;
const LN2 = Math.LN2;

/** Floor on σ so a single perfect observation never reads as certainty. */
const MIN_STDDEV = 4;
/** Extra σ per half-life elapsed since the newest evidence. */
const STALENESS_STDDEV_PER_HALFLIFE = 9;

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

/**
 * Exponential decay: an observation carries half its weight after one
 * half-life. Evidence from the future (clock skew, backfilled entries) is
 * clamped to full weight rather than amplified.
 */
export function decayFactor(ageDays: number, halfLifeDays: number): number {
  if (!(halfLifeDays > 0)) {
    throw new RangeError(`halfLifeDays must be > 0, received ${halfLifeDays}`);
  }
  if (ageDays <= 0) return 1;
  return Math.exp((-LN2 * ageDays) / halfLifeDays);
}

/**
 * Time-weighted, evidence-weighted score with a confidence interval.
 *
 * Returns nulls rather than zeros for an unproven skill: "no evidence" and
 * "evidence that you score zero" are different claims, and conflating them is
 * exactly the dishonesty this product exists to avoid.
 */
export function decayedScore(
  evidence: readonly Evidence[],
  halfLifeDays: number,
  now: Date,
): SkillScore {
  if (evidence.length === 0) {
    return { score: null, stdDev: null, evidenceCount: 0, lastEvidenceAt: null };
  }

  let weightSum = 0;
  let weightedTotal = 0;
  let lastEvidenceAt = evidence[0]!.occurredAt;

  for (const e of evidence) {
    const weight = KIND_WEIGHT[e.kind] * decayFactor(daysBetween(e.occurredAt, now), halfLifeDays);
    weightSum += weight;
    weightedTotal += clampScore(e.rawScore) * weight;
    if (e.occurredAt > lastEvidenceAt) lastEvidenceAt = e.occurredAt;
  }

  // Every observation has decayed into irrelevance. The skill is unproven now,
  // which is a different statement from "was never proven" but scores the same.
  if (weightSum === 0) {
    return { score: null, stdDev: null, evidenceCount: evidence.length, lastEvidenceAt };
  }

  const mean = weightedTotal / weightSum;

  let varianceAcc = 0;
  for (const e of evidence) {
    const weight = KIND_WEIGHT[e.kind] * decayFactor(daysBetween(e.occurredAt, now), halfLifeDays);
    varianceAcc += weight * (clampScore(e.rawScore) - mean) ** 2;
  }

  const spread = Math.sqrt(varianceAcc / weightSum);
  const stalenessDays = Math.max(0, daysBetween(lastEvidenceAt, now));
  const staleness = (stalenessDays / halfLifeDays) * STALENESS_STDDEV_PER_HALFLIFE;

  return {
    score: round2(mean),
    stdDev: round2(Math.max(MIN_STDDEV, spread + staleness)),
    evidenceCount: evidence.length,
    lastEvidenceAt,
  };
}

function clampScore(raw: number): number {
  if (Number.isNaN(raw)) throw new RangeError("rawScore must be a number, received NaN");
  return Math.min(100, Math.max(0, raw));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A stored score, faded for the time since it was last earned (FR-S4).
 *
 * This is the second half of decay, and it is not the same thing as `decayedScore` — the two compose:
 *
 * - `decayedScore` weights **evidence** by age, so a recent observation counts for more than an old
 *   one. It does *not* make the result fall as everything ages uniformly: the weights appear in both
 *   the numerator and the denominator of a weighted mean, so they cancel. Five-year-old evidence of a
 *   90 still averages to 90.
 * - `fadedScore` makes the **score itself** fall as it goes unretrieved, which is what FR-S4 asks for
 *   in as many words: "a skill you haven't touched in 6 months should visibly fade."
 *
 * Applied at read time rather than written back, so it is impossible for a stored value to disagree
 * with what the gauge shows, and so retrieval genuinely restores it rather than needing a repair job.
 *
 * The floor matters. A score fading asymptotically to 0 would eventually claim positive evidence that
 * you cannot do something, which is not what a gap in practice means — so it fades toward `null`
 * (unproven) by way of a floor, and `bandFor` treats the two the same.
 */
export function fadedScore(
  storedScore: number | null,
  lastEvidenceAt: Date | null,
  now: Date,
  halfLifeDays: number,
): number | null {
  if (storedScore === null) return null;
  // No date to measure from: report it unfaded rather than guessing an age. A stored score without a
  // timestamp is a row from before this column existed, not a score earned just now.
  if (lastEvidenceAt === null) return storedScore;

  const ageDays = daysBetween(lastEvidenceAt, now);
  if (ageDays <= 0) return storedScore;

  const faded = storedScore * decayFactor(ageDays, halfLifeDays);
  // Below this, "faded to nothing" is the honest reading and a number would imply a measurement.
  return faded < FADED_FLOOR ? null : round2(faded);
}

/**
 * Where a faded score stops being a number.
 *
 * Not zero: a decaying exponential never reaches it, so without a floor a skill from five years ago
 * would read as "0.03" — a figure precise enough to look measured and small enough to be meaningless.
 */
export const FADED_FLOOR = 1;
