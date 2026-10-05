import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  Callout,
  Card,
  Heading,
  Label,
  Row,
  Stack,
  Text,
  TextareaField,
} from "../../../shared/ui/index.js";
import type { LabExerciseView } from "../model/kinds.js";
import { SolutionReveal } from "./SolutionReveal.js";
import { CopyBlock } from "./TaskPanel.js";
import "./exercise.css";

export interface LabPanelProps {
  readonly exercise: LabExerciseView;
  /** Report the check: it worked or not, and what it printed, if anything. */
  readonly onReport: (passed: boolean, output: string | null) => void;
  readonly pending: boolean;
  /** Why the last report did not save, in the server's words. */
  readonly error: string | null;
  readonly onRevealSolution: () => void;
  readonly revealPending: boolean;
  readonly revealError: string | null;
  /** An exam item not yet passed: no solution, said plainly (FR-E5). */
  readonly examLocked?: boolean;
}

/**
 * Practice in a real environment the learner owns (the `lab` kind, FR-X11–X13).
 *
 * The order on screen is the order that keeps the learner safe: **what it costs
 * before the steps**, the steps, the one check that proves it worked, and the
 * cleanup — always shown, never folded away, because a lab that leaves something
 * running is a bill the lesson caused.
 *
 * The app never touches the environment. It records what the learner reports, in
 * their voice ("you reported"), and the output field says not to paste credentials:
 * a CLI's output can carry an access key, and the report is stored.
 */
export function LabPanel({
  exercise,
  onReport,
  pending,
  error,
  onRevealSolution,
  revealPending,
  revealError,
  examLocked = false,
}: LabPanelProps) {
  const { t } = useTranslation("exercise");
  const [output, setOutput] = useState("");
  const pasted = exercise.attempts.lastCode ?? "";
  const last = exercise.attempts.lastResults?.[0] ?? null;

  function report(passed: boolean) {
    const trimmed = output.trim();
    onReport(passed, trimmed === "" ? null : trimmed);
  }

  return (
    <Card as="section" label={t("panel.label", { title: exercise.title })}>
      <Stack gap="normal">
        <Stack gap="tight">
          <Label>{t("lab.eyebrow", { platform: exercise.platform.toUpperCase() })}</Label>
          <Heading level={2}>{exercise.title}</Heading>
          <p className="mf-exercise-prompt">{exercise.prompt}</p>
          <Text tone="hint">
            <ReportSummary exercise={exercise} />
          </Text>
        </Stack>

        <Callout tone="neutral">
          <Stack gap="tight">
            <Label>{t("lab.cost")}</Label>
            <Text>{exercise.cost}</Text>
          </Stack>
        </Callout>

        <Stack gap="tight">
          <Heading level={3}>{t("lab.steps")}</Heading>
          <ol className="mf-exercise-steps">
            {exercise.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </Stack>

        <Stack gap="tight">
          <CopyBlock
            heading={t("lab.verify")}
            text={exercise.verify.command}
            copyLabel={t("lab.copyVerify")}
          />
          <Text tone="hint">{t("lab.expect", { expect: exercise.verify.expect })}</Text>
        </Stack>

        <Stack gap="tight">
          <TextareaField
            label={t("lab.output")}
            hint={t("lab.noSecrets")}
            value={output}
            maxLength={20_000}
            rows={4}
            onChange={(event) => {
              setOutput(event.target.value);
            }}
          />
          <Row>
            <Button variant="primary" onClick={() => report(true)} disabled={pending}>
              {t("lab.report.pass")}
            </Button>
            <Button onClick={() => report(false)} disabled={pending}>
              {t("lab.report.fail")}
            </Button>
          </Row>
        </Stack>

        {error === null ? null : (
          <Callout tone="danger" live>
            <Text>{error}</Text>
          </Callout>
        )}

        {last === null ? null : (
          <div role="status">
            <Text>{last.passed ? t("lab.last.pass") : t("lab.last.fail")}</Text>
          </div>
        )}

        {pasted === "" ? null : (
          <details className="mf-exercise-logs">
            <summary>{t("task.output.previous")}</summary>
            <pre className="mf-exercise-code">{pasted}</pre>
          </details>
        )}

        <Stack gap="tight">
          <Heading level={3}>{t("lab.cleanup")}</Heading>
          <ol className="mf-exercise-steps">
            {exercise.cleanup.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </Stack>

        {examLocked ? (
          <Text tone="hint">{t("exam.noHelp")}</Text>
        ) : exercise.solution === null ? null : (
          <SolutionReveal
            exercise={exercise}
            solution={exercise.solution}
            onReveal={onRevealSolution}
            pending={revealPending}
            error={revealError}
            labels={{
              show: t("lab.solution.show"),
              hide: t("lab.solution.hide"),
              heading: t("lab.solution.heading"),
            }}
            as="prose"
          />
        )}
      </Stack>
    </Card>
  );
}

/** In the learner's voice, like a task's: the app saw none of it. */
function ReportSummary({ exercise }: { readonly exercise: LabExerciseView }) {
  const { t } = useTranslation("exercise");
  const { count, firstPassedAt } = exercise.attempts;

  if (count === 0) return <>{t("task.attempts.none")}</>;
  if (firstPassedAt === null) return <>{t("lab.attempts.tried", { count })}</>;
  return <>{count === 1 ? t("lab.attempts.passedFirst") : t("lab.attempts.passed", { count })}</>;
}
