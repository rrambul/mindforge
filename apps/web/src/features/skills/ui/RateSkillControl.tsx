import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, Row } from "../../../shared/ui/index.js";
import type { Skill } from "../api/use-skills.js";

interface RateSkillControlProps {
  readonly skill: Skill;
  readonly onRate: (perceivedLevel: number) => void;
  readonly pending: boolean;
}

/**
 * The self-rating (FR-S5) — the only number a person can set on a skill.
 *
 * A number field rather than a band picker, because the gap is arithmetic: "I'd say 70" carries
 * information that "Fluent" rounds away, and the five bands exist for reading a score, not for stating
 * a guess.
 *
 * The hint matters as much as the control. Someone who thinks this is the score will treat a high
 * rating as an achievement, which is precisely the self-report-as-evidence confusion the whole feature
 * is arranged against.
 */
export function RateSkillControl({ skill, onRate, pending }: RateSkillControlProps) {
  const { t } = useTranslation("skills");
  const [value, setValue] = useState("");

  const level = Number.parseInt(value, 10);
  const valid = Number.isFinite(level) && level >= 0 && level <= 100;

  return (
    <Row>
      <Field
        label={t("rating.label")}
        hint={t("create.ratingHint")}
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        value={value}
        // The current rating, so the box shows where you stand without pre-filling a value a stray tap
        // would re-submit unchanged.
        placeholder={
          skill.perceivedLevel === null ? t("rating.none") : String(skill.perceivedLevel)
        }
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && valid) {
            event.preventDefault();
            onRate(level);
            setValue("");
          }
        }}
      />
      <Button
        onClick={() => {
          if (!valid) return;
          onRate(level);
          setValue("");
        }}
        disabled={!valid || pending}
      >
        {t("rating.save")}
      </Button>
    </Row>
  );
}
