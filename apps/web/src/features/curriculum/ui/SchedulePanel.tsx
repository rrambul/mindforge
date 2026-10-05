import { useTranslation } from "react-i18next";

import { formatNearDay } from "../../../shared/lib/format.js";
import { Card, Heading, Spread, Stack, Text } from "../../../shared/ui/index.js";
import type { Curriculum, CurriculumModule } from "../api/use-curriculum.js";
import "./curriculum.css";

/**
 * The mission at a glance (FR-B6, FR-U4).
 *
 * For a mission planned in weeks, its weeks: each module against its dates and how
 * it stands, the calendar fixed and the gap stated. For one from before weeks, each
 * module's projected exam day. Either way the pace the projections rest on is said
 * above the list — or what is missing for there to be one (FR-U1).
 */
export function SchedulePanel({ curriculum }: { readonly curriculum: Curriculum }) {
  const { t, i18n } = useTranslation("curriculum");

  const modules = curriculum.modules.filter((module) => module.status !== "dropped");
  if (modules.length === 0) return null;

  const calendar = curriculum.calendar ?? null;
  const heading = calendar === null ? t("schedule.heading") : t("schedule.weeksHeading");

  return (
    <Card as="section" label={heading}>
      <Stack gap="tight">
        <Heading level={2}>{heading}</Heading>
        {calendar === null ? null : (
          <Text tone="muted">
            {t("schedule.calendar", {
              count: calendar.weeks,
              from: formatNearDay(calendar.startsOn, i18n.language),
              to: formatNearDay(calendar.endsOn, i18n.language),
            })}
          </Text>
        )}
        <Basis pace={curriculum.pace} />
        <ul className="mf-schedule-list" aria-label={heading}>
          {modules.map((module) => (
            <li key={module.id}>
              <Spread>
                <Text as="span">
                  {module.week == null
                    ? module.name
                    : t("schedule.weekName", { index: module.week.index, name: module.name })}
                </Text>
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

/** One module's line: where its week stands, or its projected exam without a calendar. */
function When({ module }: { readonly module: CurriculumModule }) {
  const { t, i18n } = useTranslation("curriculum");
  const day = (iso: string) => formatNearDay(iso, i18n.language);

  const { week } = module;
  if (week != null) {
    const { standing } = week;
    switch (standing.kind) {
      case "not-planned":
        return <>{t("schedule.notPlanned")}</>;
      case "upcoming":
        return <>{t("schedule.startsOn", { date: day(week.startsOn) })}</>;
      case "in-progress":
        return (
          <>
            {standing.behind > 0
              ? t("schedule.behind", { count: standing.behind })
              : t("schedule.onTrack")}
          </>
        );
      case "finished":
        return (
          <>
            {standing.daysLate === 0
              ? t("schedule.finished")
              : t("schedule.finishedLate", { count: standing.daysLate })}
          </>
        );
      case "overdue":
        return <>{t("schedule.overdue", { count: standing.daysOver })}</>;
    }
  }

  if (module.finishedAt !== null) return <>{t("schedule.finished")}</>;
  if (module.projection.status === "projected") {
    return <>{t("schedule.projected", { date: day(module.projection.examDay) })}</>;
  }
  return <>{t("schedule.noDate")}</>;
}
