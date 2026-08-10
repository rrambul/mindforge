import { useTranslation } from "react-i18next";

import { StatusChip, Text } from "../../../shared/ui/index.js";
import type { CurriculumLesson } from "../api/use-curriculum.js";
import "./curriculum.css";

interface LessonLineProps {
  readonly lesson: CurriculumLesson;
  /** The one the plan would have you do next, across the whole mission (FR-K7). */
  readonly isNext: boolean;
}

/**
 * One planned lesson, as a line you can read left to right.
 *
 * Dumb by design (§2.2 rule 5). Three things about what it renders:
 *
 * **A locked lesson says what it is waiting for.** A padlock with no reason is a
 * dead end; the prerequisite's title turns it into a route.
 *
 * **Fundamental is a count, shown as a badge only when something depends on it**
 * (FR-K6). Zero dependents is not "not fundamental yet" — it is a lesson nothing
 * is built on, which is a fine thing to be, so it gets no badge rather than a
 * greyed one.
 *
 * **An unrecorded difficulty or depth says so.** Rendering a missing difficulty as
 * a 3, or as an empty slot the eye reads as "easy", is a measurement claim about
 * something the plan never stated (non-negotiable 10).
 */
export function LessonLine({ lesson, isNext }: LessonLineProps) {
  const { t } = useTranslation("curriculum");

  const state = lesson.completed
    ? "completed"
    : lesson.unblocked
      ? "unblocked"
      : ("locked" as const);

  return (
    <li className="mf-lesson-line" data-state={state} {...(isNext ? { "data-next": "" } : {})}>
      <div className="mf-lesson-line__head">
        <Text as="span">{lesson.title}</Text>

        {isNext ? <StatusChip accent="ember">{t("lesson.next")}</StatusChip> : null}
        {lesson.completed ? (
          <StatusChip>
            {lesson.outcome === null
              ? t("lesson.completed")
              : t(`outcome.${lesson.outcome}`, { defaultValue: lesson.outcome })}
          </StatusChip>
        ) : null}
        {lesson.dependentCount > 0 ? (
          <StatusChip>{t("lesson.fundamental", { count: lesson.dependentCount })}</StatusChip>
        ) : null}
      </div>

      {lesson.intent === null ? null : <Text tone="hint">{lesson.intent}</Text>}

      <Text tone="hint">
        {lesson.difficulty === null
          ? t("lesson.difficultyUnknown")
          : t("lesson.difficulty", { level: lesson.difficulty })}
        {" · "}
        {lesson.depth === null ? t("lesson.depthUnknown") : t(`depth.${lesson.depth}`)}
        {lesson.status === "planned" ? ` · ${t("lesson.notWrittenYet")}` : ""}
      </Text>

      {state === "locked" ? (
        <Text tone="hint">
          {lesson.blockedBy.length === 0
            ? t("lesson.lockedUnnamed")
            : t("lesson.lockedBy", { lessons: lesson.blockedBy.join(", ") })}
        </Text>
      ) : null}
    </li>
  );
}
