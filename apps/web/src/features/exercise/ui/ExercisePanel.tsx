import { RUNNER_TIMEOUT_MS, type ExerciseView } from "@mindforge/core";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import {
  Button,
  Callout,
  Card,
  CodeEditor,
  Heading,
  Label,
  Row,
  Stack,
  Text,
} from "../../../shared/ui/index.js";
import type { RunOutcome } from "../api/use-runner.js";
import type { CodeExerciseView } from "../model/kinds.js";
import { HintLadder } from "./HintLadder.js";
import { SolutionReveal } from "./SolutionReveal.js";
import "./exercise.css";

export interface ExercisePanelProps {
  readonly exercise: CodeExerciseView;
  readonly code: string;
  readonly onCodeChange: (code: string) => void;
  readonly onReset: () => void;
  readonly onRun: () => void;
  /** The runner frame has said it is listening. */
  readonly ready: boolean;
  /** A run is in flight — this exercise's or another one's; there is one runner. */
  readonly busy: boolean;
  /** The last run of *this* exercise, in this visit. Null before the first. */
  readonly outcome: RunOutcome | null;
  /** The run finished and the attempt did not save. */
  readonly recordFailed: boolean;
  /** Ask for a hint at `level` (FR-H1). */
  readonly onHint: (level: number, question: string | null) => void;
  readonly hintPending: boolean;
  /** Why the last hint request came back with no hint, in the server's words. */
  readonly hintError: string | null;
  /** Record opening the reference solution (review #4). */
  readonly onRevealSolution: () => void;
  readonly revealPending: boolean;
  /** Why the reveal was not recorded, in the server's words. */
  readonly revealError: string | null;
}

/**
 * One exercise: the task, the editor, and what the tests said (FR-X2).
 *
 * Dumb on purpose. Where the code comes from, how a run reaches the runner and how
 * an attempt is saved are the route's; this renders what it is handed.
 *
 * The copy is flat. A pass says which tests passed and how many attempts it took,
 * and nothing else — no celebration, no exclamation mark (NORTHSTAR.md §3). A
 * learner who passed on the fourth attempt did something real, and a screen that
 * cheered the first attempt louder would be ranking them.
 */
export function ExercisePanel({
  exercise,
  code,
  onCodeChange,
  onReset,
  onRun,
  ready,
  busy,
  outcome,
  recordFailed,
  onHint,
  hintPending,
  hintError,
  onRevealSolution,
  revealPending,
  revealError,
}: ExercisePanelProps) {
  const { t } = useTranslation("exercise");
  // The last recorded run, after a reload, until this visit runs its own. Only a run
  // that produced results: an error or a timeout has none worth showing twice.
  const last = exercise.attempts.lastResults;
  const previous: RunOutcome | null =
    last === null || last.length === 0
      ? null
      : { status: "completed", reason: null, results: [...last], message: null, logs: [] };

  return (
    <Card as="section" label={t("panel.label", { title: exercise.title })}>
      <Stack gap="normal">
        <Stack gap="tight">
          <Label>{t("panel.eyebrow")}</Label>
          <Heading level={2}>{exercise.title}</Heading>
          <p className="mf-exercise-prompt">{exercise.prompt}</p>
          <Text tone="hint">
            <AttemptSummary exercise={exercise} />
          </Text>
        </Stack>

        <CodeEditor
          value={code}
          onChange={onCodeChange}
          language={exercise.language}
          label={t("editor.label", { title: exercise.title })}
        />

        <Row>
          <Button variant="primary" onClick={onRun} disabled={!ready || busy}>
            {!ready ? t("action.starting") : busy ? t("action.running") : t("action.run")}
          </Button>
          <Button variant="quiet" onClick={onReset} disabled={code === exercise.starter}>
            {t("action.reset")}
          </Button>
        </Row>

        {exercise.language === "python" && exercise.attempts.count === 0 ? (
          // Said up front, so the first run's wait reads as Python starting rather
          // than as the app hanging.
          <Text tone="hint">{t("python.firstRun")}</Text>
        ) : null}

        {outcome !== null ? (
          <RunResult outcome={outcome} />
        ) : previous === null ? null : (
          <Stack gap="tight">
            <Text tone="hint">{t("result.previous")}</Text>
            <RunResult outcome={previous} />
          </Stack>
        )}

        {recordFailed ? (
          <Callout tone="danger" live>
            <Text>{t("error.record")}</Text>
          </Callout>
        ) : null}

        <HintLadder exercise={exercise} onAsk={onHint} pending={hintPending} error={hintError} />

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
            note={t("solution.hint")}
            as="code"
          />
        )}
      </Stack>
    </Card>
  );
}

/**
 * What the history says, and only what it says.
 *
 * The summary carries a count and the first pass's time, not which attempt number
 * passed — so "passed on attempt 3" is not something this can know, and it does not
 * guess. The one exception is a single attempt that passed: that one is exact.
 */
function AttemptSummary({ exercise }: { readonly exercise: ExerciseView }) {
  const { t } = useTranslation("exercise");
  const { count, firstPassedAt, lastPassed } = exercise.attempts;

  if (count === 0) return <>{t("attempts.none")}</>;
  if (firstPassedAt === null)
    return <>{`${t("attempts.tried", { count })}${helpNote(exercise, t)}`}</>;

  const passed = count === 1 ? t("attempts.passedFirst") : t("attempts.passed", { count });
  const latest = lastPassed === false ? `${passed}. ${t("attempts.latestFails")}` : passed;
  return <>{`${latest}${helpNote(exercise, t)}`}</>;
}

/**
 * How much help was asked for, beside the attempts — a pass after seeing the code
 * and a pass worked out alone are different results, and the summary says which
 * (FR-H3). Nothing when no hint was asked for, rather than "0 hints".
 */
function helpNote(exercise: ExerciseView, t: TFunction<"exercise">): string {
  if (exercise.hints.length === 0) return "";
  // Opening the solution is the most help there is, and it is not a hint rung:
  // "hints up to the code" would say less than what happened (review #4).
  if (exercise.hints.some((hint) => hint.kind === "solution")) return ` · ${t("solution.opened")}`;
  const highest = exercise.hints.reduce((max, hint) => Math.max(max, hint.level), 1);
  const rung = exercise.hints.find((hint) => hint.level === highest)!.rung;
  return ` · ${t("hint.used", { rung: t(`hint.rung.${rung}`) })}`;
}

function RunResult({ outcome }: { readonly outcome: RunOutcome }) {
  const { t } = useTranslation("exercise");

  if (outcome.status !== "completed") {
    // The runner names why, as a key; the words are ours and the learner's
    // language (review #8). Its `message` is the compiler's or the interpreter's
    // own text, shown as-is beneath, like a stack trace.
    const reason = outcome.reason ?? (outcome.status === "timeout" ? "timeout" : "crashed");
    return (
      <Callout tone="warning" live>
        <Text>
          <strong>{t(`result.reason.${reason}`, { seconds: RUNNER_TIMEOUT_MS / 1000 })}</strong>
        </Text>
        {outcome.message === null ? null : (
          <pre className="mf-exercise-code">{outcome.message}</pre>
        )}
        <Logs logs={outcome.logs} />
      </Callout>
    );
  }

  const passed = outcome.results.filter((r) => r.passed).length;

  return (
    <Stack gap="tight">
      <div role="status">
        <Text>
          {outcome.results.length === 0
            ? t("result.empty")
            : t("result.summary", { passed, total: outcome.results.length })}
        </Text>
      </div>
      <ul className="mf-exercise-results">
        {outcome.results.map((result, index) => (
          <li
            // Test names can repeat; the position is what makes a row unique.
            key={`${index}-${result.name}`}
            className="mf-exercise-result"
            data-passed={result.passed ? "true" : "false"}
          >
            <span className="mf-exercise-result__verdict">
              {result.passed ? t("result.pass") : t("result.fail")}
            </span>
            <span className="mf-exercise-result__name">{result.name}</span>
            {result.message === null ? null : (
              <pre className="mf-exercise-code">{result.message}</pre>
            )}
          </li>
        ))}
      </ul>
      <Logs logs={outcome.logs} />
    </Stack>
  );
}

function Logs({ logs }: { readonly logs: readonly string[] }) {
  const { t } = useTranslation("exercise");
  if (logs.length === 0) return null;

  return (
    <details className="mf-exercise-logs">
      <summary>{t("result.logs", { count: logs.length })}</summary>
      <pre className="mf-exercise-code">{logs.join("\n")}</pre>
    </details>
  );
}
