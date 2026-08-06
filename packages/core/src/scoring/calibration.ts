import { bandFor, bandForScore, bandIndex, type Band } from "./bands.js";

/**
 * The calibration gap (FR-S5) — `perceived_level - demonstrated_level`.
 *
 * REQUIREMENTS.md calls overconfidence "the highest-value thing this app can show you", and this is
 * the number that shows it. It is the fluency-vs-storage illusion made arithmetic: reading a chapter
 * and following it feels like knowing, and the gap is how far that feeling runs ahead of the evidence.
 *
 * Two rules the whole module is built around:
 *
 * **A self-rating is never evidence.** `perceivedLevel` lives in its own column and never touches the
 * score. If it did, the gap would measure nothing — the two terms would move together by construction.
 *
 * **No score means no gap.** Not a gap of zero: an unproven skill you rate highly is exactly the
 * situation the metric exists to surface, and reporting it as perfectly calibrated would hide it.
 */

/** How far off a self-rating is, and in which direction. */
export const CALIBRATION_VERDICTS = ["overconfident", "calibrated", "underconfident"] as const;
export type CalibrationVerdict = (typeof CALIBRATION_VERDICTS)[number];

/**
 * Inside this many points, a rating is calibrated rather than wrong.
 *
 * Wide on purpose. The score itself carries a confidence interval (FR-S3) often wider than this, so a
 * tighter band would report noise as overconfidence — and a metric that cries wolf gets ignored,
 * taking the real signal with it.
 */
export const CALIBRATION_TOLERANCE = 10;

export interface Calibration {
  /**
   * `perceived - demonstrated`, positive when you think you know it better than you have shown.
   *
   * Null when there is no score, or no self-rating. Both are genuinely unknown rather than zero.
   */
  readonly gap: number | null;
  readonly verdict: CalibrationVerdict | null;
  /** Why there is no gap, so the UI can ask for the missing half rather than showing a shrug. */
  readonly missing: "score" | "self_rating" | "both" | null;
  readonly perceivedBand: Band | null;
  readonly demonstratedBand: Band | null;
  /**
   * Bands apart, signed. The number people act on — "you think you're Fluent, the evidence says
   * Assisted" lands harder than "you are 23 points out".
   */
  readonly bandGap: number | null;
}

/**
 * The gap for one skill.
 *
 * `score` must be the **decayed** score, the same figure the gauge shows. Passing the stored raw value
 * would compare a self-rating against evidence that may be a year stale, which is precisely the
 * comparison FR-S4 says not to trust.
 */
export function calibrationFor(perceivedLevel: number | null, score: number | null): Calibration {
  const missing =
    perceivedLevel === null && score === null
      ? "both"
      : score === null
        ? "score"
        : perceivedLevel === null
          ? "self_rating"
          : null;

  if (perceivedLevel === null || score === null) {
    // Whichever band is known is still reported: "you say Fluent; there is no evidence yet" is a useful
    // sentence, and it needs the band.
    return {
      gap: null,
      verdict: null,
      missing,
      perceivedBand: bandFor(perceivedLevel),
      demonstratedBand: bandFor(score),
      bandGap: null,
    };
  }

  const perceivedBand = bandForScore(perceivedLevel);
  const demonstratedBand = bandForScore(score);
  const gap = perceivedLevel - score;

  return {
    gap,
    verdict:
      Math.abs(gap) <= CALIBRATION_TOLERANCE
        ? "calibrated"
        : gap > 0
          ? "overconfident"
          : "underconfident",
    missing: null,
    perceivedBand,
    demonstratedBand,
    bandGap: bandIndex(perceivedBand) - bandIndex(demonstratedBand),
  };
}

/**
 * The average gap across skills that have one, with the count it is drawn from.
 *
 * Skills with no score are **excluded rather than counted as zero**, and the count says how many
 * contributed — a mean over three of forty skills is a fact about those three, and presenting it as
 * "your calibration" would be the same quiet overreach as a progress bar over half a goal.
 */
export function overallCalibration(
  skills: readonly { readonly perceivedLevel: number | null; readonly score: number | null }[],
): { readonly meanGap: number | null; readonly measured: number; readonly total: number } {
  const gaps = skills
    .map((skill) => calibrationFor(skill.perceivedLevel, skill.score).gap)
    .filter((gap): gap is number => gap !== null);

  return {
    meanGap: gaps.length === 0 ? null : gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length,
    measured: gaps.length,
    total: skills.length,
  };
}
