/**
 * Temper bands — the named levels a skill score maps onto.
 *
 * Band names are keys, never display text: the UI translates them at render
 * (TECH-DESIGN.md §5.2). Colours live in tokens.css and are derived from the
 * oxide sequence on tempered steel, so the order here is load-bearing.
 */

export const BANDS = ["aware", "assisted", "working", "fluent", "teaching"] as const;

export type Band = (typeof BANDS)[number];

/** Lower bound of each band, inclusive. */
const BAND_FLOOR: ReadonlyArray<readonly [Band, number]> = [
  ["teaching", 90],
  ["fluent", 70],
  ["working", 50],
  ["assisted", 25],
  ["aware", 0],
];

/** Null score means unproven — which is not the same as the lowest band. */
export function bandFor(score: number | null): Band | null {
  if (score === null) return null;
  for (const [band, floor] of BAND_FLOOR) {
    if (score >= floor) return band;
  }
  return "aware";
}

export function bandIndex(band: Band): number {
  return BANDS.indexOf(band);
}

/** Positive when `a` is the higher band. Used for goal-target progress. */
export function compareBands(a: Band, b: Band): number {
  return bandIndex(a) - bandIndex(b);
}

/**
 * How crisply to draw a skill's gauge. Uncertainty is rendered as feathered
 * edges rather than a ± footnote, so this maps directly onto a CSS token
 * (TECH-DESIGN.md §9.1, design/tokens.css).
 */
export type Feather = "crisp" | "soft" | "vague";

export function featherFor(lastEvidenceAt: Date | null, now: Date): Feather {
  if (lastEvidenceAt === null) return "vague";
  const days = (now.getTime() - lastEvidenceAt.getTime()) / 86_400_000;
  if (days < 7) return "crisp";
  if (days < 60) return "soft";
  return "vague";
}
