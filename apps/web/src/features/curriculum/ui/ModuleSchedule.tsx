import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { formatNearDay } from "../../../shared/lib/format.js";
import { Row, Stack, Text } from "../../../shared/ui/index.js";
import type { CurriculumModule } from "../api/use-curriculum.js";

interface ModuleScheduleProps {
  readonly module: CurriculumModule;
  readonly targetLink?: (target: { readonly id: string; readonly title: string }) => ReactNode;
}

/**
 * A module's exam, its week and where its pace puts it (FR-E6, FR-E7, FR-B3–B5).
 *
 * Every state here was derived by the server, and every sentence says what it is
 * measured against. Three things it refuses to do:
 *
 * - **Say "failed" for an exam that does not exist yet.** An unwritten exam is "not
 *   written yet", which is a different fact from 0 of 4.
 * - **Move a date.** The week's dates are fixed (FR-B4); being behind is a count of
 *   lessons, said once.
 * - **Celebrate or scold.** A late week says how late, in the same tone as an on-time
 *   one (non-negotiable 10).
 */
export function ModuleSchedule({ module, targetLink }: ModuleScheduleProps) {
  if (module.status === "dropped") return null;

  return (
    <Stack gap="tight">
      <WeekLine module={module} />
      <ExamLine module={module} {...(targetLink ? { targetLink } : {})} />
      <PaceLine module={module} />
    </Stack>
  );
}

function ExamLine({
  module,
  targetLink,
}: {
  readonly module: CurriculumModule;
  readonly targetLink?: ModuleScheduleProps["targetLink"];
}) {
  const { t } = useTranslation("curriculum");

  // A module with no plan has no lessons to finish and so nothing to examine yet;
  // the line above it already says so.
  if (module.progress === null) return null;

  const { exam } = module;
  if (exam === null) {
    const lessonsDone = module.progress.completed === module.progress.total;
    return <Text tone="hint">{lessonsDone ? t("exam.notWritten") : t("exam.afterLessons")}</Text>;
  }

  const link = targetLink?.({ id: exam.lessonId, title: exam.title }) ?? null;
  const { result } = exam;

  const summary =
    result === null
      ? t("exam.noItems")
      : result.passed
        ? t("exam.passed", { total: result.total })
        : result.attempted
          ? t("exam.partly", { passed: result.passedCount, total: result.total })
          : t("exam.notSat", { total: result.total });

  return (
    <Stack gap="tight">
      <Row>
        <Text>{summary}</Text>
        {link}
      </Row>
      {result !== null && result.selfReportedPasses > 0 ? (
        <Text tone="hint">{t("exam.selfReported", { count: result.selfReportedPasses })}</Text>
      ) : null}
      {result !== null && !result.passed && result.attempted && result.revisit.length > 0 ? (
        <Row>
          <Text tone="hint">{t("exam.revisit")}</Text>
          {result.revisit.map((lesson) => (
            <span key={lesson.id}>{targetLink?.(lesson) ?? lesson.title}</span>
          ))}
        </Row>
      ) : null}
    </Stack>
  );
}

/** The module's week on the calendar, and how it stands today (FR-B3, FR-B5). */
function WeekLine({ module }: { readonly module: CurriculumModule }) {
  const { t, i18n } = useTranslation("curriculum");
  const day = (iso: string) => formatNearDay(iso, i18n.language);

  // `== null`: an older body carries no week at all.
  const { week } = module;
  if (week == null) return null;

  const { standing } = week;
  const sentence = (() => {
    switch (standing.kind) {
      case "not-planned":
        return t("week.notPlanned");
      case "upcoming":
        return t("week.upcoming", { count: standing.startsInDays });
      case "in-progress": {
        const today =
          standing.dueToday > 0 ? ` ${t("week.dueToday", { count: standing.dueToday })}` : "";
        if (standing.behind > 0) {
          return (
            t("week.behind", {
              count: standing.behind,
              completed: standing.completed,
              total: standing.total,
            }) + today
          );
        }
        return standing.examToday
          ? t("week.examToday")
          : t("week.onTrack", { completed: standing.completed, total: standing.total }) + today;
      }
      case "finished":
        return standing.daysLate === 0
          ? t("week.finishedOnTime")
          : t("week.finishedLate", { count: standing.daysLate });
      case "overdue":
        return standing.lessonsLeft === 0
          ? t("week.overdueExam", { count: standing.daysOver })
          : t("week.overdue", { count: standing.daysOver, left: standing.lessonsLeft });
    }
  })();

  return (
    <Stack gap="tight">
      <Text tone="muted">
        {t("week.dates", {
          index: week.index,
          from: day(week.startsOn),
          to: day(week.endsOn),
          exam: day(week.examOn),
        })}
      </Text>
      <Text>{sentence}</Text>
    </Stack>
  );
}

/**
 * Where the learner's pace puts the module's exam (FR-U4). Beside a week it is one
 * line of information, never a date that moves the calendar (FR-B4).
 */
function PaceLine({ module }: { readonly module: CurriculumModule }) {
  const { t, i18n } = useTranslation("curriculum");

  if (module.finishedAt !== null) return null;
  const { projection } = module;
  if (projection.status === "projected") {
    const date = formatNearDay(projection.examDay, i18n.language);
    return (
      <Text tone="hint">
        {module.week == null
          ? t("projection.examOn", { date })
          : t("projection.atYourPace", { date })}
      </Text>
    );
  }
  if (projection.status === "unknown" && projection.reason === "after-unplanned") {
    return <Text tone="hint">{t("projection.afterUnplanned")}</Text>;
  }
  return null;
}
