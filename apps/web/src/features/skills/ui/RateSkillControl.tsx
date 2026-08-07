import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CardSection, Field } from "../../../shared/ui/index.js";
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
    // Its own section: the one number a person can set is the one thing on this card that is not a
    // reading of something already recorded, and the rule is what says so.
    <CardSection>
      <Field
        label={t("rating.label")}
        hint={t("create.ratingHint")}
        // The hint is the point of this control, and it is long — as a sibling in a `Row` it made the
        // box for a two-digit number 500px wide. `action` keeps the two on one line and the sentence
        // under both.
        action={
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
        }
        width="short"
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        value={value}
        // The current rating, so the box shows where you stand without pre-filling a value a stray tap
        // would re-submit unchanged. Nothing at all when there is no rating: the label says what the
        // box is for, and the gauge above has already said that nothing has been rated or measured —
        // a sentence of prose inside a box this size would only be clipped.
        {...(skill.perceivedLevel === null ? {} : { placeholder: String(skill.perceivedLevel) })}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && valid) {
            event.preventDefault();
            onRate(level);
            setValue("");
          }
        }}
      />
    </CardSection>
  );
}
