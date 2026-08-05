import { INTENTION_OUTCOMES, type IntentionOutcome } from "@mindforge/core";
import { useTranslation } from "react-i18next";

/**
 * The debrief's two controls, shared by the live flow and by backfill.
 *
 * Extracted rather than duplicated because the questions are the same questions — "did you hit
 * it" means one thing, and asking it with different affordances in two places would make the two
 * populations of answers subtly incomparable.
 */

const RATINGS = [1, 2, 3, 4, 5] as const;

interface OutcomeChipsProps {
  readonly legend: string;
  readonly value: IntentionOutcome | null;
  readonly onChange: (outcome: IntentionOutcome) => void;
}

export function OutcomeChips({ legend, value, onChange }: OutcomeChipsProps) {
  const { t } = useTranslation("focus");

  return (
    <fieldset className="mf-fieldset">
      <legend className="mf-label">{legend}</legend>
      <div className="mf-chips__row">
        {INTENTION_OUTCOMES.map((outcome) => (
          <button
            key={outcome}
            type="button"
            className={value === outcome ? "mf-chip-button mf-chip-button--on" : "mf-chip-button"}
            // A coloured background communicates nothing to a screen reader; this is what does.
            aria-pressed={value === outcome}
            onClick={() => onChange(outcome)}
          >
            {t(`debrief.outcome.${outcome}`)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

interface RatingRowProps {
  readonly legend: string;
  readonly value: number | null;
  readonly onChange: (value: number) => void;
}

export function RatingRow({ legend, value, onChange }: RatingRowProps) {
  return (
    <fieldset className="mf-fieldset">
      <legend className="mf-label">{legend}</legend>
      <div className="mf-chips__row">
        {RATINGS.map((rating) => (
          <button
            key={rating}
            type="button"
            className={value === rating ? "mf-chip-button mf-chip-button--on" : "mf-chip-button"}
            aria-pressed={value === rating}
            onClick={() => onChange(rating)}
          >
            <span className="mf-figure">{rating}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
