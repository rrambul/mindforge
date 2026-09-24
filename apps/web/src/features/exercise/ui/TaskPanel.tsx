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
import type { TaskExerciseView } from "../model/kinds.js";
import { SolutionReveal } from "./SolutionReveal.js";
import "./exercise.css";

export interface TaskPanelProps {
  readonly exercise: TaskExerciseView;
  /** Report the run: the tests passed or not, and what the terminal printed, if anything. */
  readonly onReport: (passed: boolean, output: string | null) => void;
  /** A report is in flight. */
  readonly pending: boolean;
  /** Why the last report did not save, in the server's words. */
  readonly error: string | null;
  /** Record opening the reference solution (review #4). */
  readonly onRevealSolution: () => void;
  readonly revealPending: boolean;
  /** Why the reveal was not recorded, in the server's words. */
  readonly revealError: string | null;
}

/**
 * An exercise the learner runs on their own machine (the `task` kind).
 *
 * For the languages the browser cannot run — Elixir, Rust, Go — the lesson hands
 * over everything needed to set it up: every file in full, with a copy button, and
 * the one command that runs the tests. The app cannot see that run, so what it
 * records is the learner's report of it, and every line here says so: "you
 * reported", never "passed" on its own. A self-report is honest data only while it
 * is labelled as one.
 *
 * Dumb, like the other panels: where a report goes and how it is saved are the
 * route's.
 */
export function TaskPanel({
  exercise,
  onReport,
  pending,
  error,
  onRevealSolution,
  revealPending,
  revealError,
}: TaskPanelProps) {
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
          <Label>{t("task.eyebrow")}</Label>
          <Heading level={2}>{exercise.title}</Heading>
          <p className="mf-exercise-prompt">{exercise.prompt}</p>
          <Text tone="hint">
            {t("task.onYourMachine", { language: displayName(exercise.language) })}
          </Text>
          <Text tone="hint">
            <ReportSummary exercise={exercise} />
          </Text>
        </Stack>

        <Stack gap="tight">
          <Heading level={3}>{t("task.files")}</Heading>
          {exercise.files.map((file) => (
            <CopyBlock
              key={file.path}
              heading={file.path}
              text={file.contents}
              copyLabel={t("task.copy.label", { name: file.path })}
            />
          ))}
        </Stack>

        <CopyBlock
          heading={t("task.command")}
          text={exercise.command}
          copyLabel={t("task.copy.command")}
        />

        <Stack gap="tight">
          <TextareaField
            label={t("task.output.label")}
            value={output}
            maxLength={20_000}
            rows={4}
            onChange={(event) => {
              setOutput(event.target.value);
            }}
          />
          <Row>
            <Button variant="primary" onClick={() => report(true)} disabled={pending}>
              {t("task.report.pass")}
            </Button>
            <Button onClick={() => report(false)} disabled={pending}>
              {t("task.report.fail")}
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
            <Text>{last.passed ? t("task.last.pass") : t("task.last.fail")}</Text>
          </div>
        )}

        {pasted === "" ? null : (
          <details className="mf-exercise-logs">
            <summary>{t("task.output.previous")}</summary>
            <pre className="mf-exercise-code">{pasted}</pre>
          </details>
        )}

        {exercise.solution === null ? null : (
          <SolutionReveal
            exercise={exercise}
            solution={exercise.solution}
            onReveal={onRevealSolution}
            pending={revealPending}
            error={revealError}
            labels={{
              show: t("solution.show"),
              hide: t("solution.hide"),
              heading: t("solution.heading"),
            }}
            as="code"
          />
        )}
      </Stack>
    </Card>
  );
}

/**
 * Derived from the count and the first pass only, like the other panels — and
 * always in the learner's voice, because the app saw none of it.
 */
function ReportSummary({ exercise }: { readonly exercise: TaskExerciseView }) {
  const { t } = useTranslation("exercise");
  const { count, firstPassedAt } = exercise.attempts;

  if (count === 0) return <>{t("task.attempts.none")}</>;
  if (firstPassedAt === null) return <>{t("task.attempts.tried", { count })}</>;
  return <>{count === 1 ? t("task.attempts.passedFirst") : t("task.attempts.passed", { count })}</>;
}

/** `elixir` → `Elixir`. The declaration's label is lowercase by contract; a sentence is not. */
function displayName(language: string): string {
  return language.charAt(0).toUpperCase() + language.slice(1);
}

type CopyState = "idle" | "copied" | "failed";

/** A file or a command, with a copy button that says when copying did not work. */
function CopyBlock({
  heading,
  text,
  copyLabel,
}: {
  readonly heading: string;
  readonly text: string;
  /** The button's accessible name: which thing it copies. */
  readonly copyLabel: string;
}) {
  const { t } = useTranslation("exercise");
  const [state, setState] = useState<CopyState>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // No clipboard permission, or no clipboard at all: the text is right there.
      setState("failed");
    }
  }

  return (
    <Stack gap="tight">
      <Row>
        <Label>{heading}</Label>
        <Button variant="quiet" onClick={() => void copy()} aria-label={copyLabel}>
          {state === "copied" ? t("task.copy.done") : t("task.copy.action")}
        </Button>
      </Row>
      <pre className="mf-exercise-code">{text}</pre>
      {state === "failed" ? <Text tone="hint">{t("task.copy.failed")}</Text> : null}
    </Stack>
  );
}
