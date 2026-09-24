import type { SceneElement, TestResult } from "@mindforge/core";
import { useTranslation } from "react-i18next";

import {
  Button,
  Callout,
  Card,
  Heading,
  Label,
  Row,
  Stack,
  StatusChip,
  Text,
  Whiteboard,
  type WhiteboardHandle,
} from "../../../shared/ui/index.js";
import type { WhiteboardExerciseView } from "../model/kinds.js";
import { SolutionReveal } from "./SolutionReveal.js";
import "./exercise.css";

export interface WhiteboardPanelProps {
  readonly exercise: WhiteboardExerciseView;
  readonly initialElements: readonly SceneElement[];
  readonly onElementsChange: (elements: SceneElement[]) => void;
  readonly onReady: (handle: WhiteboardHandle | null) => void;
  readonly onSubmit: () => void;
  /** A review is in flight. */
  readonly pending: boolean;
  /** Nothing is drawn, so there is nothing to review. */
  readonly empty: boolean;
  /** Why the last submission came back without a review, in the server's words. */
  readonly error: string | null;
  /** Record opening the reference solution (review #4). */
  readonly onRevealSolution: () => void;
  readonly revealPending: boolean;
  /** Why the reveal was not recorded, in the server's words. */
  readonly revealError: string | null;
}

/**
 * One design exercise: the task, the canvas, and what the reviewer said (FR-X7–X9).
 *
 * Dumb, like `ExercisePanel`. The feedback is labelled for what it is — one AI
 * reader's view of a drawing against a checklist — and never as a grade: there is
 * no score, and "partly there" is shown as plainly as "covered".
 *
 * The rubric appears only once the server sends it, which is after the first
 * review. Before that there is no checklist on screen to draw towards.
 */
export function WhiteboardPanel({
  exercise,
  initialElements,
  onElementsChange,
  onReady,
  onSubmit,
  pending,
  empty,
  error,
  onRevealSolution,
  revealPending,
  revealError,
}: WhiteboardPanelProps) {
  const { t } = useTranslation("exercise");
  const results = exercise.attempts.lastResults;

  return (
    <Card as="section" label={t("panel.label", { title: exercise.title })}>
      <Stack gap="normal">
        <Stack gap="tight">
          <Label>{t("whiteboard.eyebrow")}</Label>
          <Heading level={2}>{exercise.title}</Heading>
          <p className="mf-exercise-prompt">{exercise.prompt}</p>
          <Text tone="hint">
            <ReviewSummary exercise={exercise} />
          </Text>
        </Stack>

        <Whiteboard
          initialElements={initialElements}
          onChange={onElementsChange}
          onReady={onReady}
          label={t("whiteboard.canvas", { title: exercise.title })}
        />

        <Row>
          <Button variant="primary" onClick={onSubmit} disabled={pending || empty}>
            {pending
              ? t("whiteboard.reviewing")
              : empty
                ? t("whiteboard.empty")
                : t("whiteboard.submit")}
          </Button>
        </Row>

        {error === null ? null : (
          <Callout tone="warning" live>
            <Text>{error}</Text>
          </Callout>
        )}

        {results === null || results.length === 0 ? null : <Review results={results} />}

        {exercise.solution === null ? null : (
          <SolutionReveal
            exercise={exercise}
            solution={exercise.solution}
            onReveal={onRevealSolution}
            pending={revealPending}
            error={revealError}
            labels={{
              show: t("whiteboard.solution.show"),
              hide: t("whiteboard.solution.hide"),
              heading: t("whiteboard.solution.heading"),
            }}
            as="prose"
          />
        )}
      </Stack>
    </Card>
  );
}

/** Derived from the count and the first pass only, like the code panel's summary. */
function ReviewSummary({ exercise }: { readonly exercise: WhiteboardExerciseView }) {
  const { t } = useTranslation("exercise");
  const { count, firstPassedAt } = exercise.attempts;

  if (count === 0) return <>{t("whiteboard.attempts.none")}</>;
  if (firstPassedAt === null) return <>{t("whiteboard.attempts.tried", { count })}</>;
  return (
    <>
      {count === 1
        ? t("whiteboard.attempts.passedFirst")
        : t("whiteboard.attempts.passed", { count })}
    </>
  );
}

function Review({ results }: { readonly results: readonly TestResult[] }) {
  const { t } = useTranslation("exercise");

  return (
    <Stack gap="tight">
      <Heading level={3}>{t("whiteboard.review.heading")}</Heading>
      <Text tone="hint">{t("whiteboard.review.disclaimer")}</Text>
      <ul className="mf-exercise-results">
        {results.map((result, index) => {
          const verdict = result.verdict ?? (result.passed ? "covered" : "missing");
          return (
            <li
              key={`${index}-${result.name}`}
              className="mf-exercise-result"
              data-passed={result.passed ? "true" : "false"}
              data-verdict={verdict}
            >
              <StatusChip>{t(`whiteboard.verdict.${verdict}`)}</StatusChip>
              <span className="mf-exercise-result__name">{result.name}</span>
              {result.message === null ? null : (
                <p className="mf-exercise-hint__answer">{result.message}</p>
              )}
            </li>
          );
        })}
      </ul>
    </Stack>
  );
}
