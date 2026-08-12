import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { OutcomeCounts } from "@mindforge/core";
import {
  Card,
  Heading,
  ProgressBar,
  Spread,
  Stack,
  StatusChip,
  Text,
} from "../../../shared/ui/index.js";

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

        {/* The bar is the fraction in a second channel and never replaces it — an
            unplanned module gets the sentence and no bar at all, because an empty
            track is a claim that something was measured and came out at zero. */}
        {module.progress === null ? (
          <Text tone="muted">{t("module.noPlan")}</Text>
        ) : (
          <Stack gap="tight">
            <Text tone="muted">
              {t("module.progress", {
                completed: module.progress.completed,
                total: module.progress.total,
              })}
            </Text>
            <ProgressBar
              completed={module.progress.completed}
              total={module.progress.total}
              label={t("module.progressLabel", { module: module.name })}
              valueText={t("module.progress", {
                completed: module.progress.completed,
                total: module.progress.total,
              })}
            />
          </Stack>
        )}

        <Outcomes outcomes={module.outcomes} />

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

/**
 * How the module's finished lessons landed (FR-P4).
 *
 * **Only once something is finished.** A distribution of four zeros under every
 * module you have not started is furniture: the fraction above already says
 * "0 of 5 lessons done", and repeating it as three named zeros adds nothing and
 * makes the panel harder to scan.
 *
 * **`shaky` is stated plainly and never softened.** A module that is four
 * understood and two shaky is a different module from one that is six
 * understood, and the whole reason the outcome exists is that the second is not
 * a rounding of the first (non-negotiable 10).
 *
 * **Completions with no outcome are counted, not dropped.** They are M4 rows,
 * finished before the reader could ask, and leaving them out would show three
 * outcomes against a fraction that says five.
 */
function Outcomes({ outcomes }: { readonly outcomes: OutcomeCounts | null }) {
  const { t } = useTranslation("curriculum");

  if (outcomes === null) return null;

  const parts = [
    outcomes.understood > 0 ? t("outcomes.understood", { count: outcomes.understood }) : null,
    outcomes.shaky > 0 ? t("outcomes.shaky", { count: outcomes.shaky }) : null,
    outcomes.lost > 0 ? t("outcomes.lost", { count: outcomes.lost }) : null,
    outcomes.unrecorded > 0 ? t("outcomes.unrecorded", { count: outcomes.unrecorded }) : null,
  ].filter((part): part is string => part !== null);

  if (parts.length === 0) return null;

  return <Text tone="hint">{parts.join(" · ")}</Text>;
}
