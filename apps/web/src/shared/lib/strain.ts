import type { StrainView } from "@mindforge/core";
import type { TFunction } from "i18next";

/**
 * How a lesson landed, as words (FR-D1) — shared because the curriculum and the
 * exercise panel both say it, and two phrasings of one verdict is how the screens
 * start to disagree.
 *
 * Null for an unknown verdict, and the null is the treatment: "in progress" and
 * "nothing to judge" are not verdicts, and rendering them as a chip would claim a
 * measurement nobody made (non-negotiable 10). The reasons are always shown with the
 * verdict, so a "Too hard" never appears without what it was based on.
 */
export interface StrainWords {
  readonly verdict: "too-hard" | "in-zone" | "too-easy";
  readonly label: string;
  readonly reasons: string;
}

export function strainWords(strain: StrainView, g: TFunction<"glossary">): StrainWords | null {
  if (strain.verdict === null) return null;

  return {
    verdict: strain.verdict,
    label: g(`strainVerdict.${strain.verdict}`),
    reasons: strain.reasons.map((reason) => g(`strainReason.${reason}`)).join(", "),
  };
}
