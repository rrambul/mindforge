import type { ExerciseView } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Callout, Heading, Row, Stack, Text } from "../../../shared/ui/index.js";
import "./exercise.css";

export interface SolutionRevealProps {
  readonly exercise: ExerciseView;
  /** The text to show. The caller passes it only when there is one. */
  readonly solution: string;
  /** Record the reveal. The solution is shown only once the record is back. */
  readonly onReveal: () => void;
  readonly pending: boolean;
  /** Why the reveal was not recorded, in the server's words. */
  readonly error: string | null;
  readonly labels: { readonly show: string; readonly hide: string; readonly heading: string };
  /** A line under the heading, when the panel has one to say. */
  readonly note?: string;
  /** Code in a block; a reference design as prose. */
  readonly as: "code" | "prose";
}

/**
 * The reference solution, behind a button that records opening it (review #4).
 *
 * Opening it is help, and a pass after seeing the answer is not a pass worked out
 * alone — so the first opening is recorded, and the learner is told that before
 * they press. The solution appears only once the server's reply carries the
 * `kind: "solution"` entry: a reveal is never on screen without being on record,
 * and a reveal that failed to record shows its error and not the answer.
 *
 * After that, showing and hiding is local; the server writes the reveal once.
 */
export function SolutionReveal({
  exercise,
  solution,
  onReveal,
  pending,
  error,
  labels,
  note,
  as,
}: SolutionRevealProps) {
  const { t } = useTranslation("exercise");
  const [wanted, setWanted] = useState(false);
  const recorded = exercise.hints.some((hint) => hint.kind === "solution");
  const shown = wanted && recorded;

  function toggle() {
    if (shown) {
      setWanted(false);
      return;
    }
    setWanted(true);
    if (!recorded) onReveal();
  }

  return (
    <Stack gap="tight">
      <Row>
        <Button variant="quiet" onClick={toggle} disabled={pending} aria-expanded={shown}>
          {shown ? labels.hide : labels.show}
        </Button>
      </Row>
      {recorded ? null : <Text tone="hint">{t("solution.recorded")}</Text>}

      {error === null ? null : (
        <Callout tone="warning" live>
          <Text>{error}</Text>
        </Callout>
      )}

      {shown ? (
        <Stack gap="tight">
          <Heading level={3}>{labels.heading}</Heading>
          {note === undefined ? null : <Text tone="hint">{note}</Text>}
          {as === "code" ? (
            <pre className="mf-exercise-code">{solution}</pre>
          ) : (
            <p className="mf-exercise-prompt">{solution}</p>
          )}
        </Stack>
      ) : null}
    </Stack>
  );
}
