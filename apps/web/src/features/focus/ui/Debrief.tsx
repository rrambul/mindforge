import {
  INTENTION_OUTCOMES,
  type DebriefFocusSessionInput,
  type IntentionOutcome,
} from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button.js";

interface DebriefProps {
  readonly onSubmit: (debrief: DebriefFocusSessionInput) => void;
  readonly onSkip: () => void;
  readonly pending: boolean;
}

const RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * The ≤30-second debrief (FR-F3).
 *
 * Three questions, all answerable by tapping, none required — and **Skip is a first-class
 * button, not a dismissal**. A debrief you cannot decline is one you learn to answer carelessly,
 * and careless answers are worse than absent ones: `producedLearning` reads `hitIntention`, so a
 * reflexive "yes" would inflate the ember share permanently.
 *
 * Submit stays disabled until something is answered, because an empty debrief is a mistake rather
 * than an answer — and Skip is right there for when nothing is what you mean.
 */
export function Debrief({ onSubmit, onSkip, pending }: DebriefProps) {
  const { t } = useTranslation("focus");
  const [hitIntention, setHitIntention] = useState<IntentionOutcome | null>(null);
  const [focusQuality, setFocusQuality] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);

  const answered = hitIntention !== null || focusQuality !== null || energy !== null;

  function submit(): void {
    onSubmit({
      ...(hitIntention === null ? {} : { hitIntention }),
      ...(focusQuality === null ? {} : { focusQuality }),
      ...(energy === null ? {} : { energy }),
    });
  }

  return (
    <section className="mf-card mf-stack" aria-label={t("debrief.label")}>
      <h2 className="mf-h2">{t("debrief.heading")}</h2>

      <fieldset className="mf-fieldset">
        <legend className="mf-label">{t("debrief.hitIntention")}</legend>
        <div className="mf-chips__row">
          {INTENTION_OUTCOMES.map((outcome) => (
            <button
              key={outcome}
              type="button"
              className={
                hitIntention === outcome ? "mf-chip-button mf-chip-button--on" : "mf-chip-button"
              }
              aria-pressed={hitIntention === outcome}
              onClick={() => setHitIntention(outcome)}
            >
              {t(`debrief.outcome.${outcome}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <RatingRow
        legend={t("debrief.focusQuality")}
        value={focusQuality}
        onChange={setFocusQuality}
      />
      <RatingRow legend={t("debrief.energy")} value={energy} onChange={setEnergy} />

      <div className="mf-row">
        <Button variant="primary" onClick={submit} disabled={pending || !answered}>
          {pending ? t("debrief.saving") : t("debrief.save")}
        </Button>
        {/* Not a quiet link: declining is a legitimate answer and should look like one. */}
        <Button onClick={onSkip} disabled={pending}>
          {t("debrief.skip")}
        </Button>
      </div>
    </section>
  );
}

interface RatingRowProps {
  readonly legend: string;
  readonly value: number | null;
  readonly onChange: (value: number) => void;
}

function RatingRow({ legend, value, onChange }: RatingRowProps) {
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
