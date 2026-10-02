import { useTranslation } from "react-i18next";

import { formatNearDay } from "../../../shared/lib/format.js";
import { Card, Heading, Spread, Stack, Text } from "../../../shared/ui/index.js";
import type { Curriculum, CurriculumModule } from "../api/use-curriculum.js";
import "./curriculum.css";

/**
 * The schedule: every module's exam on a date (FR-U4).
 *
 * A committed date reads as **due** and a derived one as **projected**, always, so
 * the two can never be mistaken for each other. Above the list is what every
 * projection rests on — or what is missing for there to be one — because a date
 * with no basis shown is a claim nobody can check (FR-U1).
 */
export function SchedulePanel({ curriculum }: { readonly curriculum: Curriculum }) {
  const { t } = useTranslation("curriculum");

  const modules = curriculum.modules.filter((module) => module.status !== "dropped");
  if (modules.length === 0) return null;

  return (
    <Card as="section" label={t("schedule.heading")}>
      <Stack gap="tight">
        <Heading level={2}>{t("schedule.heading")}</Heading>
        <Basis pace={curriculum.pace} />
        <ul className="mf-schedule-list" aria-label={t("schedule.heading")}>
          {modules.map((module) => (
            <li key={module.id}>
              <Spread>
                <Text as="span">{module.name}</Text>
                <Text as="span" tone="muted">
                  <When module={module} />
                </Text>
              </Spread>
            </li>
          ))}
        </ul>
      </Stack>
    </Card>
  );
}

function Basis({ pace }: { readonly pace: Curriculum["pace"] }) {
  const { t, i18n } = useTranslation("curriculum");

  if (pace.status === "known") {
    // Two significant digits below ten, whole minutes above: 0.46 a day is a measured
    // pace, and rounding it to "0 minutes a day" would show a zero the projection
    // never used (non-negotiable 10).
    const minutes = (value: number) =>
      new Intl.NumberFormat(
        i18n.language,
        value < 10 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 0 },
      ).format(value);
    return (
      <Text tone="hint">
        {t("schedule.basis", {
          minutes: minutes(pace.minutesPerLesson),
          count: pace.timedLessons,
          perDay: minutes(pace.minutesPerDay),
          days: pace.windowDays,
        })}
      </Text>
    );
  }

  return (
    <Text tone="hint">
      {[
        t("schedule.unknown"),
        ...(pace.missing.includes("timed-lessons")
          ? [t("schedule.needsTimedLessons", { count: pace.timedLessons })]
          : []),
        ...(pace.missing.includes("recent-time") ? [t("schedule.needsRecentTime")] : []),
      ].join(" ")}
    </Text>
  );
}

function When({ module }: { readonly module: CurriculumModule }) {
  const { t, i18n } = useTranslation("curriculum");
  const day = (iso: string) => formatNearDay(iso, i18n.language);

  if (module.finishedAt !== null) {
    return <>{t("schedule.finished")}</>;
  }
  if (module.deadline !== null) {
    return <>{t("schedule.due", { date: day(module.deadline.dueOn) })}</>;
  }
  if (module.projection.status === "projected") {
    return <>{t("schedule.projected", { date: day(module.projection.examDay) })}</>;
  }
  return <>{t("schedule.noDate")}</>;
}
