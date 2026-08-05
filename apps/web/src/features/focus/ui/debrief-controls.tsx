import { INTENTION_OUTCOMES, type IntentionOutcome } from "@mindforge/core";
import { useTranslation } from "react-i18next";
import { ChoiceGroup, Figure, type Choice } from "../../../shared/ui/index.js";

/**
 * The debrief's two questions, shared by the live flow and by backfill.
 *
 * Thin wrappers over `ChoiceGroup` rather than components of their own: the interaction is generic
 * and belongs to the design system, while *which* answers exist is a focus-domain fact. Extracted
 * rather than duplicated because the questions mean the same thing in both places — asking them
 * with different affordances would make the two populations of answers quietly incomparable.
 */

const RATINGS = [1, 2, 3, 4, 5] as const;

export function OutcomeChips({
  legend,
  value,
  onChange,
}: {
  readonly legend: string;
  readonly value: IntentionOutcome | null;
  readonly onChange: (outcome: IntentionOutcome) => void;
}) {
  const { t } = useTranslation("focus");

  const choices: Choice<IntentionOutcome>[] = INTENTION_OUTCOMES.map((outcome) => ({
    value: outcome,
    label: t(`debrief.outcome.${outcome}`),
  }));

  return <ChoiceGroup legend={legend} choices={choices} value={value} onChange={onChange} />;
}

export function RatingRow({
  legend,
  value,
  onChange,
}: {
  readonly legend: string;
  readonly value: number | null;
  readonly onChange: (value: number) => void;
}) {
  const choices: Choice<number>[] = RATINGS.map((rating) => ({
    value: rating,
    label: <Figure>{rating}</Figure>,
  }));

  return <ChoiceGroup legend={legend} choices={choices} value={value} onChange={onChange} />;
}
