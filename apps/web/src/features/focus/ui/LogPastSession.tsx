import type { CreateFocusSessionInput } from "@mindforge/core";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button.js";
import { Field } from "../../../shared/ui/Field.js";
import {
  defaultPastSession,
  pastSessionToInput,
  type PastSessionForm,
  type PastSessionProblem,
} from "../model/past-session.js";
import { OutcomeChips, RatingRow } from "./debrief-controls.js";

interface LogPastSessionProps {
  readonly onSubmit: (input: CreateFocusSessionInput) => void;
  readonly onCancel: () => void;
  readonly pending: boolean;
}

/**
 * FR-F2 — the session you forgot to time.
 *
 * "You _will_ forget the timer. If backfilling is painful, the data dies within two weeks." So the
 * shape is date, start, and a duration in minutes rather than two datetimes: three fields that are
 * already filled in plausibly, so the common case is one edit. Asking for an end time instead of a
 * length would be asking you to do arithmetic about a block you barely remember.
 *
 * The debrief is optional and uses the same controls as the live flow — the questions mean the same
 * thing, and asking them differently here would make the two sets of answers incomparable.
 */
export function LogPastSession({ onSubmit, onCancel, pending }: LogPastSessionProps) {
  const { t } = useTranslation("focus");
  const { t: common } = useTranslation("common");
  const [form, setForm] = useState<PastSessionForm>(() => defaultPastSession());
  const [problem, setProblem] = useState<PastSessionProblem | null>(null);

  function patch(changes: Partial<PastSessionForm>): void {
    setForm((current) => ({ ...current, ...changes }));
    setProblem(null);
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    const result = pastSessionToInput(form);
    if ("problem" in result) {
      setProblem(result.problem);
      return;
    }
    onSubmit(result.input);
  }

  const errorFor = (field: PastSessionProblem["field"]): string | undefined =>
    problem?.field === field ? t(`past.error.${problem.code}`) : undefined;

  return (
    <form className="mf-card mf-stack" onSubmit={submit} aria-label={t("past.label")} noValidate>
      <h2 className="mf-h2">{t("past.heading")}</h2>

      <div className="mf-row mf-row--fields">
        <Field
          label={t("past.date")}
          type="date"
          value={form.date}
          onChange={(event) => patch({ date: event.target.value })}
          error={errorFor("date")}
        />
        <Field
          label={t("past.startTime")}
          type="time"
          value={form.startTime}
          onChange={(event) => patch({ startTime: event.target.value })}
          error={errorFor("startTime")}
        />
        <Field
          label={t("past.minutes")}
          type="number"
          inputMode="numeric"
          min={1}
          value={form.minutes}
          onChange={(event) => patch({ minutes: Number(event.target.value) })}
          error={errorFor("minutes")}
        />
      </div>

      <Field
        label={t("past.intention")}
        hint={t("past.intentionHint")}
        value={form.intention}
        onChange={(event) => patch({ intention: event.target.value })}
      />

      <OutcomeChips
        legend={t("debrief.hitIntention")}
        value={form.hitIntention}
        onChange={(hitIntention) => patch({ hitIntention })}
      />
      <RatingRow
        legend={t("debrief.focusQuality")}
        value={form.focusQuality}
        onChange={(focusQuality) => patch({ focusQuality })}
      />
      <RatingRow
        legend={t("debrief.energy")}
        value={form.energy}
        onChange={(energy) => patch({ energy })}
      />

      <div className="mf-row">
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? t("past.saving") : t("past.submit")}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {common("action.cancel")}
        </Button>
      </div>
    </form>
  );
}
