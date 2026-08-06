import { useTranslation } from "react-i18next";
import { Stack, Text } from "../../../shared/ui/index.js";
import type { Skill } from "../api/use-skills.js";
import "./skill-card.css";

/**
 * The evidence gauge, and the self-rating as a mark on the same scale.
 *
 * Two decisions carry the honesty here:
 *
 * **An unproven skill gets no bar.** A track with an empty fill reads as zero, and zero is a claim —
 * "we measured, and you cannot do this". The dashed placeholder plus a sentence says the true thing.
 *
 * **The rating is a mark, not a second bar.** The number worth seeing is the *distance* between what
 * you think and what you have shown; two bars invite reading them as two independent quantities, which
 * is exactly the comparison FR-S5 exists to force.
 */
export function SkillGauge({ skill }: { readonly skill: Skill }) {
  const { t } = useTranslation("skills");

  // Narrows `skill.score` on its own — TypeScript infers the type predicate from the comparison, so
  // the branches below need no non-null assertions.
  const hasScore = skill.score !== null;

  return (
    <Stack>
      <div
        className="mf-gauge"
        {...(hasScore ? {} : { "data-unproven": "true" })}
        {...(hasScore
          ? {
              role: "progressbar",
              "aria-valuenow": Math.round(skill.score),
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-label": t("score.label"),
            }
          : {})}
      >
        {hasScore ? (
          <div
            className="mf-gauge__fill"
            // Feathered by how stale the evidence is, so a vague score cannot be read as a precise one.
            data-feather={skill.feather}
            style={{ width: `${Math.round(skill.score)}%` }}
          />
        ) : null}
      </div>

      {/* The rating's mark sits on the same scale below the bar. */}
      {skill.perceivedLevel === null ? null : (
        <div className="mf-gauge__rating" aria-hidden="true">
          <div
            className="mf-gauge__mark"
            style={{ left: `${Math.round(skill.perceivedLevel)}%` }}
          />
        </div>
      )}

      <Text tone="muted">
        {hasScore
          ? `${t("score.label")} ${t("score.value", { score: Math.round(skill.score) })}${
              skill.scoreStdDev === null
                ? ""
                : ` ${t("score.plusMinus", { stdDev: Math.round(skill.scoreStdDev) })}`
            }`
          : t("score.unproven")}
      </Text>

      {/* Said in words, not implied by an empty bar. */}
      {hasScore ? null : <Text tone="muted">{t("score.unprovenHint")}</Text>}
    </Stack>
  );
}
