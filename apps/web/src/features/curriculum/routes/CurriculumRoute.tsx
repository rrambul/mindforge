import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import { Button, Callout, Card, Heading, Row, Stack, Text } from "../../../shared/ui/index.js";
import { useCurriculum, type Curriculum, type CurriculumLesson } from "../api/use-curriculum.js";
import { ModulePanel } from "../ui/ModulePanel.js";

export interface CurriculumRouteProps {
  readonly missionId: string;
  /** The mission's topic, from the route that already has it. */
  readonly topic?: string;
  /** "Teach me the next thing", handed in by the app layer (§2.2 rule 6). */
  readonly teach?: ReactNode;
  /**
   * The way in to a written lesson (FR-T5), rendered by the app layer.
   *
   * A slot rather than a link built here, for the reason `MissionCard` takes its
   * curriculum link as one: the route it points at is the app's composition, and a
   * feature that named it would drag the router into every test that renders a module.
   */
  readonly lessonLink?: (lesson: CurriculumLesson) => ReactNode;
  /** The reference shelf and the written record (FR-T6), also a route the app owns. */
  readonly library?: ReactNode;
}

/**
 * A mission's curriculum: modules in order, each module's lessons (FR-K5).
 *
 * The screen answers three questions in the order you ask them — what is this
 * made of, where am I in it, and what can I do next — which is why the module
 * fractions sit above the lesson lists and the next lesson is badged rather than
 * lifted into a panel of its own. Pulling it out would answer the third question
 * first and turn a plan into a queue.
 *
 * An empty curriculum is a real state and says so: the mission exists and the
 * `curriculum` skill has not run against its workspace yet. **The action it names
 * is a terminal command, not a button**, because nothing in the app dispatches a
 * curriculum run today — the teach button queues a lesson, and the `teach` skill
 * is told `CURRICULUM.md` is an input it must never write. Offering it here would
 * be a button that cannot do the thing the sentence above it promises.
 */
export function CurriculumRoute({
  missionId,
  topic,
  teach,
  lessonLink,
  library,
}: CurriculumRouteProps) {
  const { t } = useTranslation("curriculum");
  const curriculum = useCurriculum(missionId);

  return (
    <Stack gap="loose">
      <Heading level={1}>{topic ?? t("heading")}</Heading>

      <Loaded query={curriculum}>
        {(data) =>
          data.modules.length === 0 ? (
            <Card as="section" label={t("empty.heading")}>
              <Stack gap="tight">
                <Heading level={2}>{t("empty.heading")}</Heading>
                <Text tone="muted">{t("empty.body")}</Text>
                <Text as="span">
                  <code>{t("empty.command")}</code>
                </Text>
                <Text tone="hint">{t("empty.then")}</Text>
              </Stack>
            </Card>
          ) : (
            <Stack gap="normal">
              {teach}
              {library}
              {data.modules.map((module) => (
                <ModulePanel
                  key={module.id}
                  module={module}
                  nextLessonId={data.nextLessonId}
                  {...(lessonLink ? { lessonLink } : {})}
                />
              ))}
            </Stack>
          )
        }
      </Loaded>
    </Stack>
  );
}

/** Loading and failure, the same shape every read screen uses. */
function Loaded({
  query,
  children,
}: {
  readonly query: UseQueryResult<Curriculum>;
  readonly children: (data: Curriculum) => ReactNode;
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

function describe(error: unknown, common: (key: string) => string): string {
  if (error instanceof NetworkError) return common("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return common("error.unexpectedBody");
}
