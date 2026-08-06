import { useTranslation } from "react-i18next";
import { Callout, Text } from "../../../shared/ui/index.js";
import type { Skill } from "../api/use-skills.js";

/**
 * The calibration gap in words (FR-S5).
 *
 * REQUIREMENTS.md calls overconfidence the highest-value thing the app can show, so it is a sentence
 * rather than a number in a corner — and it is stated flatly, with no softening. "You rate this 40
 * points above the evidence" is the whole product in one line.
 *
 * When there is no gap, *which half is missing* decides what to say. "Rated but never demonstrated" is
 * a finding; "rate yourself and this will tell you whether you were right" is an invitation. Rendering
 * either as "calibrated" would be the single most misleading thing this screen could do.
 */
export function CalibrationNote({ skill }: { readonly skill: Skill }) {
  const { t } = useTranslation("skills");
  const { t: g } = useTranslation("glossary");

  if (skill.calibrationGap === null) {
    return (
      <Text tone="muted">
        {skill.calibrationMissing === "score"
          ? t("calibration.needsScore")
          : skill.calibrationMissing === "self_rating"
            ? t("calibration.needsRating")
            : t("calibration.needsBoth")}
      </Text>
    );
  }

  const points = Math.abs(Math.round(skill.calibrationGap));

  return (
    <Callout tone={skill.calibrationVerdict === "overconfident" ? "warning" : "neutral"}>
      <Text>
        {skill.calibrationVerdict === "overconfident"
          ? t("calibration.overconfident", { gap: points })
          : skill.calibrationVerdict === "underconfident"
            ? t("calibration.underconfident", { gap: points })
            : t("calibration.calibrated")}
      </Text>

      {/* The band sentence is what people act on — "you say Fluent, the evidence says Assisted" lands
          harder than a point count. Only shown when the bands actually differ. */}
      {skill.bandGap !== null &&
      skill.bandGap !== 0 &&
      skill.band !== null &&
      skill.perceivedBand !== null ? (
        <Text tone="muted">
          {/* Both bands come from the server. Recomputing either from the raw numbers would put a
              second copy of core's thresholds in the client, which is what non-negotiable 3 rules out. */}
          {t("calibration.bands", {
            perceived: g(`band.${skill.perceivedBand}`),
            demonstrated: g(`band.${skill.band}`),
          })}
        </Text>
      ) : null}
    </Callout>
  );
}
