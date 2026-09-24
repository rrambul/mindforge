import { SCENE_IMAGE_MAX, type ExerciseView, type StrainView } from "@mindforge/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import { strainWords } from "../../../shared/lib/strain.js";
import {
  Button,
  Callout,
  Row,
  Stack,
  Text,
  type WhiteboardHandle,
} from "../../../shared/ui/index.js";
import {
  useLessonExercises,
  useRecordAttempt,
  useReportTask,
  useRequestHint,
  useRequestReview,
  useRevealSolution,
} from "../api/use-exercises.js";
import { useRunner, type Runner, type RunOutcome } from "../api/use-runner.js";
import type { CodeExerciseView, TaskExerciseView, WhiteboardExerciseView } from "../model/kinds.js";
import { useDraft } from "../model/use-draft.js";
import { useSceneDraft } from "../model/use-scene-draft.js";
import { ExercisePanel } from "../ui/ExercisePanel.js";
import { RunnerFrame } from "../ui/RunnerFrame.js";
import { TaskPanel } from "../ui/TaskPanel.js";
import { WhiteboardPanel } from "../ui/WhiteboardPanel.js";

/** The longer side of the image a review reads, and the smaller one tried if that is too large. */
export const REVIEW_IMAGE_SIDES = [1600, 1000] as const;

/**
 * A lesson's exercises, beside the lesson (FR-X1–X6).
 *
 * **Renders nothing at all** until there is something to do: while loading, and
 * for a lesson with no exercises — which is every lesson written before Phase 1.
 * Nothing rather than a placeholder, because the reader lays itself out in two
 * columns only when this slot has content, and a spinner here would split the
 * screen for a lesson that turns out to have no exercise.
 *
 * A failed load is the one exception. An error the learner cannot see is an
 * exercise they will never know they missed.
 */
export function LessonExercises({ lessonId }: { readonly lessonId: string }) {
  const { t } = useTranslation("exercise");
  const { t: common } = useTranslation("common");
  const query = useLessonExercises(lessonId);

  if (query.isError) {
    return (
      <Callout tone="danger" live>
        <Text>{t("error.load")}</Text>
        <Row>
          <Button onClick={() => void query.refetch()}>{common("action.retry")}</Button>
        </Row>
      </Callout>
    );
  }

  if (!query.isSuccess || query.data.exercises.length === 0) return null;

  return (
    <Workbench
      lessonId={lessonId}
      runnerUrl={query.data.runnerUrl}
      pythonRunnerUrl={query.data.pythonRunnerUrl}
      exercises={query.data.exercises}
      strain={query.data.strain}
    />
  );
}

/**
 * One runner frame per language group, shared by that group's exercises: a frame
 * hosts one worker at a time, so two exercises running at once would only queue
 * anyway. JavaScript and TypeScript run on `runnerUrl`, under `connect-src 'none'`;
 * Python runs on `pythonRunnerUrl`, the only page allowed to fetch its interpreter
 * (review #9). A lesson with no code to run loads no runner at all.
 */
function Workbench({
  lessonId,
  runnerUrl,
  pythonRunnerUrl,
  exercises,
  strain,
}: {
  readonly lessonId: string;
  readonly runnerUrl: string;
  readonly pythonRunnerUrl: string;
  readonly exercises: readonly ExerciseView[];
  readonly strain: StrainView;
}) {
  const { t } = useTranslation("exercise");
  const { t: g } = useTranslation("glossary");
  // Only once the lesson is finished and judged (FR-D1); unknown renders nothing.
  const landed = strainWords(strain, g);

  return (
    <Stack gap="normal">
      {landed === null ? null : (
        <Text tone="hint">
          {t("landed", { verdict: landed.label.toLowerCase(), reasons: landed.reasons })}
        </Text>
      )}
      <CodeExercises
        lessonId={lessonId}
        src={runnerUrl}
        exercises={codeOf(exercises).filter((e) => e.language !== "python")}
        python={false}
      />
      <CodeExercises
        lessonId={lessonId}
        src={pythonRunnerUrl}
        exercises={codeOf(exercises).filter((e) => e.language === "python")}
        python
      />
      {exercises.map((exercise) =>
        exercise.kind === "whiteboard" ? (
          <WhiteboardSlot key={exercise.key} lessonId={lessonId} exercise={exercise} />
        ) : exercise.kind === "task" ? (
          <TaskSlot key={exercise.key} lessonId={lessonId} exercise={exercise} />
        ) : null,
      )}
    </Stack>
  );
}

function codeOf(exercises: readonly ExerciseView[]): CodeExerciseView[] {
  return exercises.filter((e): e is CodeExerciseView => e.kind === "code");
}

/** One runner frame and the code exercises that share it. Nothing at all for none. */
function CodeExercises(props: {
  readonly lessonId: string;
  readonly src: string;
  readonly exercises: readonly CodeExerciseView[];
  readonly python: boolean;
}) {
  if (props.exercises.length === 0) return null;
  return <RunnerGroup {...props} />;
}

function RunnerGroup({
  lessonId,
  src,
  exercises,
  python,
}: {
  readonly lessonId: string;
  readonly src: string;
  readonly exercises: readonly CodeExerciseView[];
  readonly python: boolean;
}) {
  const { t } = useTranslation("exercise");
  const runner = useRunner();
  const { ready, warm } = runner;

  // Start Python as soon as its runner is listening, not on the first press: it
  // takes seconds the first time, and those seconds are better spent while the
  // learner is still reading the task. Again after a new frame (a timeout replaces it).
  useEffect(() => {
    if (ready && python) warm("python");
  }, [ready, python, warm, runner.generation]);

  return (
    <>
      <RunnerFrame
        key={runner.generation}
        src={src}
        title={python ? t("runner.pythonTitle") : t("runner.title")}
        frameRef={runner.frameRef}
      />
      {exercises.map((exercise) => (
        <CodeSlot key={exercise.key} lessonId={lessonId} exercise={exercise} runner={runner} />
      ))}
    </>
  );
}

function CodeSlot({
  lessonId,
  exercise,
  runner,
}: {
  readonly lessonId: string;
  readonly exercise: CodeExerciseView;
  readonly runner: Runner;
}) {
  const { draft, setCode, reset } = useDraft(lessonId, exercise);
  const record = useRecordAttempt(lessonId);
  const hint = useRequestHint(lessonId);
  const reveal = useRevealSolution(lessonId);
  const { t: common } = useTranslation("common");
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);

  function askForHint(level: number, question: string | null) {
    hint.mutate({
      key: exercise.key,
      input: {
        level,
        // What is in the editor now, not the last attempt: the learner is usually
        // stuck on code they have not run yet.
        code: draft.code,
        lastRun:
          outcome === null
            ? null
            : { status: outcome.status, results: outcome.results, message: outcome.message },
        question,
      },
    });
  }

  async function run() {
    record.reset();
    const result = await runner.run({
      language: exercise.language,
      code: draft.code,
      tests: exercise.tests,
    });
    // Nothing ran — not ready, busy, or the panel went away — so there is no
    // attempt to record (review #5).
    if (result === null) return;
    setOutcome(result);
    // Every run is an attempt, whatever it ended as. A syntax error on the way to a
    // pass is part of how long the pass took, and dropping it would flatter the count.
    record.mutate({
      key: exercise.key,
      input: {
        code: draft.code,
        status: result.status,
        results: result.results,
        startedAt: draft.startedAt,
      },
    });
  }

  return (
    <ExercisePanel
      exercise={exercise}
      code={draft.code}
      onCodeChange={setCode}
      onReset={reset}
      onRun={() => void run()}
      ready={runner.ready}
      busy={runner.busy}
      outcome={outcome}
      recordFailed={record.isError}
      onHint={askForHint}
      hintPending={hint.isPending}
      hintError={hint.isError ? describe(hint.error, common) : null}
      onRevealSolution={() => {
        reveal.mutate(exercise.key);
      }}
      revealPending={reveal.isPending}
      revealError={reveal.isError ? describe(reveal.error, common) : null}
    />
  );
}

/**
 * One design exercise: the canvas, its draft, and the review (FR-X7–X9).
 *
 * The image is exported at the moment of submitting, not kept: it is derived from
 * the elements, and a stored copy would be a second version of the drawing that
 * could disagree with the first.
 */
/** A task the learner runs in their own terminal, and reports back. No runner, no hints. */
function TaskSlot({
  lessonId,
  exercise,
}: {
  readonly lessonId: string;
  readonly exercise: TaskExerciseView;
}) {
  const { t: common } = useTranslation("common");
  const report = useReportTask(lessonId);
  const reveal = useRevealSolution(lessonId);

  return (
    <TaskPanel
      exercise={exercise}
      onRevealSolution={() => {
        reveal.mutate(exercise.key);
      }}
      revealPending={reveal.isPending}
      revealError={reveal.isError ? describe(reveal.error, common) : null}
      onReport={(passed, output) => {
        report.mutate({ key: exercise.key, input: { passed, output } });
      }}
      pending={report.isPending}
      error={report.isError ? describe(report.error, common) : null}
    />
  );
}

function WhiteboardSlot({
  lessonId,
  exercise,
}: {
  readonly lessonId: string;
  readonly exercise: WhiteboardExerciseView;
}) {
  const { t } = useTranslation("exercise");
  const { t: common } = useTranslation("common");
  const { draft, setElements } = useSceneDraft(lessonId, exercise);
  const review = useRequestReview(lessonId);
  const reveal = useRevealSolution(lessonId);
  const handle = useRef<WhiteboardHandle | null>(null);
  // The scene the canvas opened with, fixed for this mount: the canvas owns it after.
  const [initial] = useState(() => draft.elements);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function submit() {
    const canvas = handle.current;
    if (canvas === null) return;
    review.reset();
    setExportError(null);
    setExporting(true);

    try {
      let image: string | null = null;
      for (const side of REVIEW_IMAGE_SIDES) {
        const candidate = await canvas.exportPng(side);
        if (candidate.length <= SCENE_IMAGE_MAX) {
          image = candidate;
          break;
        }
      }
      if (image === null) {
        setExportError(t("whiteboard.error.tooLarge"));
        return;
      }
      review.mutate({
        key: exercise.key,
        input: { elements: canvas.elements(), image, startedAt: draft.startedAt },
      });
    } catch {
      setExportError(t("whiteboard.error.export"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <WhiteboardPanel
      exercise={exercise}
      initialElements={initial}
      onElementsChange={setElements}
      onReady={(ready) => {
        handle.current = ready;
      }}
      onSubmit={() => void submit()}
      pending={exporting || review.isPending}
      empty={draft.elements.length === 0}
      onRevealSolution={() => {
        reveal.mutate(exercise.key);
      }}
      revealPending={reveal.isPending}
      revealError={reveal.isError ? describe(reveal.error, common) : null}
      error={exportError ?? (review.isError ? describe(review.error, common) : null)}
    />
  );
}

/**
 * The server's own words for a refused hint — out of budget, locked rung, not set
 * up — because each one tells the learner something different to do next.
 */
function describe(error: unknown, t: (key: string) => string): string {
  if (error instanceof NetworkError) return t("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return t("error.unexpectedBody");
}
