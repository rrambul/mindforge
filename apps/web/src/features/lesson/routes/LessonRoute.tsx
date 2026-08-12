import type { LessonOutcome } from "@mindforge/core";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import {
  Button,
  Callout,
  Card,
  Heading,
  Row,
  Stack,
  StatusChip,
  Text,
} from "../../../shared/ui/index.js";
import {
  useClearCompletion,
  useCompleteLesson,
  useLesson,
  type Lesson,
} from "../api/use-lesson.js";
import { LessonFrame } from "../ui/LessonFrame.js";
import { OutcomeTray } from "../ui/OutcomeTray.js";
import "../ui/lesson.css";

export interface LessonRouteProps {
  readonly lessonId: string;
  /** Back to the curriculum, handed in by the app layer — it owns the route table. */
  readonly back?: ReactNode;
  /** Start the timer on this lesson (FR-F3), from the focus feature via the app layer. */
  readonly focus?: ReactNode;
  /** What the plan would have you do next, composed from the curriculum and teach. */
  readonly next?: ReactNode;
  /** This lesson's learning records (FR-T6), from the library feature. */
  readonly records?: ReactNode;
}

/**
 * Reading a lesson, and saying how it went (FR-T5, FR-P1).
 *
 * The page is ordered by what you do with it: the title and where it sits, the
 * lesson, the outcome, then what is next. The outcome is *under* the frame rather
 * than in the header on purpose — you record it when you finish, and a control at
 * the top is one you meet before you have anything to say.
 *
 * Three states, and the middle one is the one worth getting right:
 *
 * - **Written.** The frame, sandboxed.
 * - **Planned.** There is no file. This is not an error and does not read like
 *   one: the lesson exists as an intention, and the way forward is to have it
 *   taught, which the `next` slot offers.
 * - **Failed.** The request did not come back. Retry, like every other read screen.
 */
export function LessonRoute({ lessonId, back, focus, next, records }: LessonRouteProps) {
  const { t } = useTranslation("lesson");
  const { t: common } = useTranslation("common");
  const query = useLesson(lessonId);
  const complete = useCompleteLesson(lessonId);
  const clear = useClearCompletion(lessonId);

  return (
    <Loaded query={query}>
      {(lesson) => (
        <Stack gap="normal">
          <Stack gap="tight">
            {back}
            <Heading level={1}>{lesson.title}</Heading>
            <Meta lesson={lesson} />
            {lesson.intent === null ? null : <Text tone="hint">{lesson.intent}</Text>}
          </Stack>

          {lesson.view === null ? (
            <Card as="section" label={t("unwritten.heading")}>
              <Stack gap="tight">
                <Heading level={2}>{t("unwritten.heading")}</Heading>
                <Text tone="muted">
                  {lesson.status === "planned"
                    ? t("unwritten.planned")
                    : t("unwritten.noWorkspace")}
                </Text>
              </Stack>
            </Card>
          ) : (
            <LessonFrame url={lesson.view.url} title={lesson.title} />
          )}

          <div className="mf-lesson-tray">
            <Stack gap="tight">
              <OutcomeTray
                outcome={lesson.outcome}
                onRecord={(outcome: LessonOutcome) => {
                  complete.mutate(outcome);
                }}
                onClear={() => {
                  clear.mutate();
                }}
                pending={complete.isPending || clear.isPending}
                {...(lesson.view === null ? { disabledReason: t("outcome.unwritten") } : {})}
              />

              {complete.isError || clear.isError ? (
                <Callout tone="danger" live>
                  <Text>{describe(complete.error ?? clear.error, common)}</Text>
                </Callout>
              ) : null}

              {/* Only for a lesson there is something to read. Timing a planned lesson
                  would be timing an empty frame, and the reader auto-times what is open
                  (`useAutoLessonSession`) — so mounting this on an unwritten one would
                  record minutes against a file that does not exist. */}
              {lesson.view === null ? null : <Row>{focus}</Row>}
            </Stack>
          </div>

          {next}
          {records}
        </Stack>
      )}
    </Loaded>
  );
}

/**
 * Where the lesson sits and how hard it is.
 *
 * An unrecorded difficulty or depth says so rather than rendering as a middling
 * value — the plan never stated it, and a 3 would be a claim about something
 * nobody measured (non-negotiable 10).
 */
function Meta({ lesson }: { readonly lesson: Lesson }) {
  const { t } = useTranslation("lesson");
  const { t: c } = useTranslation("curriculum");

  return (
    <Row>
      {lesson.moduleName === null ? (
        <StatusChip>{t("meta.offPlan")}</StatusChip>
      ) : (
        <StatusChip>{lesson.moduleName}</StatusChip>
      )}
      <Text tone="hint">
        {lesson.difficulty === null
          ? c("lesson.difficultyUnknown")
          : c("lesson.difficulty", { level: lesson.difficulty })}
        {" · "}
        {lesson.depth === null ? c("lesson.depthUnknown") : c(`depth.${lesson.depth}`)}
      </Text>
    </Row>
  );
}

/** Loading and failure, the same shape every read screen uses. */
function Loaded({
  query,
  children,
}: {
  readonly query: UseQueryResult<Lesson>;
  readonly children: (data: Lesson) => ReactNode;
}) {
  const { t: common } = useTranslation("common");

  if (query.isError) {
    return (
      <Callout tone="danger" live>
        <Text>{describe(query.error, common)}</Text>
        <Row>
          <Button onClick={() => void query.refetch()}>{common("action.retry")}</Button>
        </Row>
      </Callout>
    );
  }

  if (!query.isSuccess) return <Text tone="muted">{common("state.loading")}</Text>;

  return <>{children(query.data)}</>;
}

function describe(error: unknown, t: (key: string) => string): string {
  if (error instanceof NetworkError) return t("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return t("error.unexpectedBody");
}
