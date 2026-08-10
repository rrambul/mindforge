import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Card, Heading, Spread, Stack, StatusChip, Text } from "../../../shared/ui/index.js";
import type { CurriculumLesson, CurriculumModule } from "../api/use-curriculum.js";
import { LessonLine } from "./LessonLine.js";
import "./curriculum.css";

interface ModulePanelProps {
  readonly module: CurriculumModule;
  /** The lesson the plan would have you do next, or null. */
  readonly nextLessonId: string | null;
  /** The way in to a written lesson, from the app layer. */
  readonly lessonLink?: (lesson: CurriculumLesson) => ReactNode;
}

/**
 * One module: what it is for, how far through it you are, and its lessons.
 *
 * The fraction is rendered as a fraction — "2 of 7" — and not as a percentage.
 * A percentage of a plan that gets revised reads as a measurement of the learner;
 * a fraction reads as what it is, a count of lessons against a plan that can
 * change. A module with no plan says so instead of showing an empty bar
 * (non-negotiable 10, and `moduleProgress` returns null for exactly this).
 */
export function ModulePanel({ module, nextLessonId, lessonLink }: ModulePanelProps) {
  const { t } = useTranslation("curriculum");
  const { t: g } = useTranslation("glossary");

  const dropped = module.status === "dropped";

  return (
    <Card as="section" variant={dropped ? "muted" : "raised"} label={module.name}>
      <Stack gap="tight">
        <Spread>
          <Heading level={2}>{module.name}</Heading>
          <StatusChip>
            {dropped ? t("module.dropped") : g(`trackStatus.${module.status}`)}
          </StatusChip>
        </Spread>

        {module.outcome === null ? (
          <Text tone="hint">{t("module.noOutcome")}</Text>
        ) : (
          <Text>{t("module.outcome", { outcome: module.outcome })}</Text>
        )}

        {module.prerequisites.length > 0 ? (
          <Text tone="hint">
            {t("module.builtOn", { modules: module.prerequisites.join(", ") })}
          </Text>
        ) : null}

        <Text tone="muted">
          {module.progress === null
            ? t("module.noPlan")
            : t("module.progress", {
                completed: module.progress.completed,
                total: module.progress.total,
              })}
        </Text>

        {module.lessons.length > 0 ? (
          <ul className="mf-lesson-list" aria-label={t("module.lessons", { module: module.name })}>
            {module.lessons.map((lesson) => (
              <LessonLine
                key={lesson.id}
                lesson={lesson}
                isNext={lesson.id === nextLessonId}
                {...(lessonLink ? { link: lessonLink(lesson) } : {})}
              />
            ))}
          </ul>
        ) : null}
      </Stack>
    </Card>
  );
}
