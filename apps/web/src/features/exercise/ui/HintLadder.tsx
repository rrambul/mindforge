import { HINT_RUNGS, rungOf, type ExerciseView } from "@mindforge/core";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  Callout,
  Heading,
  Label,
  Row,
  Stack,
  Text,
  TextareaField,
} from "../../../shared/ui/index.js";

export interface HintLadderProps {
  readonly exercise: ExerciseView;
  /** Ask at `level`, optionally with the learner's own question. */
  readonly onAsk: (level: number, question: string | null) => void;
  readonly pending: boolean;
  /** The server's own words for why no hint came back, when one did not. */
  readonly error: string | null;
}

/**
 * Help, one rung at a time (FR-H1–H4).
 *
 * The next rung is named on the button before it is pressed — "Get a hint: a clue"
 * — so the learner chooses how much to give away rather than discovering it. The
 * rung is the server's (`nextHintLevel`), never a count kept here: a ladder the
 * client climbed on its own would be one the server refuses at the next step.
 *
 * A question typed by the learner is answered at the rung they are already on, not
 * one higher. Asking in your own words is not a request to be shown more.
 */
export function HintLadder({ exercise, onAsk, pending, error }: HintLadderProps) {
  const { t } = useTranslation("exercise");
  const [question, setQuestion] = useState("");

  const next = exercise.nextHintLevel;
  const highest = exercise.hints.reduce((max, hint) => Math.max(max, hint.level), 0);
  const atTop = highest === HINT_RUNGS.length;
  const currentRung = Math.max(1, highest);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (trimmed === "") return;
    onAsk(currentRung, trimmed);
    setQuestion("");
  }

  return (
    <Stack gap="tight">
      <Heading level={3}>{t("hint.heading")}</Heading>
      {exercise.hints.length === 0 ? <Text tone="hint">{t("hint.intro")}</Text> : null}

      {exercise.hints.length === 0 ? null : (
        <ol className="mf-exercise-hints">
          {exercise.hints.map((hint, index) =>
            // A reveal is listed as what it was — the solution, opened — and never as
            // a rung with the answer printed under it (review #4).
            hint.kind === "solution" ? (
              <li key={`${index}-${hint.createdAt}`} className="mf-exercise-hint">
                <Label>{t("solution.openedEntry")}</Label>
              </li>
            ) : (
              <li key={`${index}-${hint.createdAt}`} className="mf-exercise-hint">
                <Label>
                  {t("hint.level", {
                    level: hint.level,
                    total: HINT_RUNGS.length,
                    rung: t(`hint.rung.${hint.rung}`),
                  })}
                </Label>
                {hint.question === null ? null : (
                  <Text tone="muted">{t("hint.youAsked", { question: hint.question })}</Text>
                )}
                <p className="mf-exercise-hint__answer">{hint.answer}</p>
              </li>
            ),
          )}
        </ol>
      )}

      <Row>
        <Button onClick={() => onAsk(next, null)} disabled={pending}>
          {pending
            ? t("hint.pending")
            : atTop
              ? t("hint.again", { rung: t(`hint.rung.${rungOf(next)}`) })
              : t("hint.next", { rung: t(`hint.rung.${rungOf(next)}`) })}
        </Button>
      </Row>

      <form onSubmit={submit}>
        <Stack gap="tight">
          <TextareaField
            label={t("hint.ask.label")}
            hint={t("hint.ask.hint")}
            value={question}
            maxLength={1000}
            rows={2}
            onChange={(event) => {
              setQuestion(event.target.value);
            }}
          />
          <Row>
            <Button type="submit" variant="quiet" disabled={pending || question.trim() === ""}>
              {t("hint.ask.submit")}
            </Button>
          </Row>
        </Stack>
      </form>

      {error === null ? null : (
        <Callout tone="warning" live>
          <Text>{error}</Text>
        </Callout>
      )}
    </Stack>
  );
}
