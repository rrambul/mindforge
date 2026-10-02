import { DEADLINE_LATEST } from "@mindforge/core";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { formatNearDay } from "../../../shared/lib/format.js";
import { Button, Callout, Field, Row, Stack, Text } from "../../../shared/ui/index.js";
import type { CurriculumModule } from "../api/use-curriculum.js";

export interface DeadlineControl {
  readonly onCommit: (dueOn: string) => void;
  readonly pending: boolean;
  /** Already translated. */
  readonly error: string | null;
}

interface ModuleScheduleProps {
  readonly module: CurriculumModule;
  /** The learner's local day, from the server. */
  readonly today: string;
  /** This is the module the learner is in: the one place a deadline is asked for (FR-U5). */
  readonly isCurrent: boolean;
  /**
   * The date proposed for this module, when it is current and has no deadline —
   * `null` when there is no estimate to propose from. `undefined` when there is no
   * proposal at all.
   */
  readonly proposedDueOn?: string | null;
  readonly deadline?: DeadlineControl;
  readonly targetLink?: (target: { readonly id: string; readonly title: string }) => ReactNode;
}

/**
 * A module's exam, its deadline and where its pace puts it (FR-E6, FR-E7, FR-U2–U5).
 *
 * Every state here was derived by the server, and every sentence says what it is
 * measured against. Three things it refuses to do:
 *
 * - **Say "failed" for an exam that does not exist yet.** An unwritten exam is "not
 *   written yet", which is a different fact from 0 of 4.
 * - **Show a date without its history.** A moved deadline says the date it was first
 *   committed to and how many times it moved.
 * - **Celebrate or scold.** A missed date is stated once, with how late, in the same
 *   tone as a kept one (non-negotiable 10).
 */
export function ModuleSchedule({
  module,
  today,
  isCurrent,
  proposedDueOn,
  deadline,
  targetLink,
}: ModuleScheduleProps) {
  const { t } = useTranslation("curriculum");

  if (module.status === "dropped") return null;

  return (
    <Stack gap="tight">
      <ExamLine module={module} {...(targetLink ? { targetLink } : {})} />
      <DeadlineLine module={module} />
      {isCurrent && module.finishedAt === null && deadline ? (
        <DeadlinePrompt
          key={`${module.id}:${module.deadline?.dueOn ?? ""}`}
          today={today}
          hasDeadline={module.deadline !== null}
          proposedDueOn={proposedDueOn ?? null}
          control={deadline}
          label={t("deadline.commitLabel", { module: module.name })}
        />
      ) : null}
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

function DeadlineLine({ module }: { readonly module: CurriculumModule }) {
  const { t, i18n } = useTranslation("curriculum");
  const day = (iso: string) => formatNearDay(iso, i18n.language);

  const projected = module.projection.status === "projected" ? module.projection.examDay : null;
  const { deadline } = module;

  if (deadline === null) {
    if (module.finishedAt !== null) return null;
    if (projected !== null) {
      return <Text tone="muted">{t("projection.examOn", { date: day(projected) })}</Text>;
    }
    if (module.projection.status === "unknown" && module.projection.reason === "after-unplanned") {
      return <Text tone="hint">{t("projection.afterUnplanned")}</Text>;
    }
    return null;
  }

  const due = day(deadline.dueOn);
  const { status } = deadline;
  const sentence = (() => {
    switch (status.kind) {
      case "met":
        return t("deadline.met", { date: due, count: status.daysEarly });
      case "missed":
        return t("deadline.missed", { date: due, count: status.daysLate });
      case "overdue":
        return t("deadline.overdue", { date: due, count: status.daysOver });
      case "due-today":
        return t("deadline.dueToday");
      case "on-track":
        return t("deadline.onTrack", {
          date: due,
          count: status.daysLeft,
          projected: projected === null ? due : day(projected),
        });
      case "behind":
        return t("deadline.behind", {
          date: due,
          count: status.daysLeft,
          projected: projected === null ? due : day(projected),
          behind: status.daysBehind,
        });
      case "no-projection":
        return t("deadline.noProjection", { date: due, count: status.daysLeft });
    }
  })();

  return (
    <Stack gap="tight">
      <Text>{sentence}</Text>
      {deadline.moves > 0 ? (
        <Text tone="hint">
          {t("deadline.moved", { first: day(deadline.firstDueOn), count: deadline.moves })}
        </Text>
      ) : null}
    </Stack>
  );
}

/**
 * Commit to a date, or move it (FR-U2, FR-U5).
 *
 * Prefilled with the proposal when there is one, so accepting it is one tap. Moving
 * an existing deadline is behind a second button rather than always open: it is
 * allowed, and it is kept on the record, and it should not be the first thing the
 * module offers.
 */
function DeadlinePrompt({
  today,
  hasDeadline,
  proposedDueOn,
  control,
  label,
}: {
  readonly today: string;
  readonly hasDeadline: boolean;
  readonly proposedDueOn: string | null;
  readonly control: DeadlineControl;
  readonly label: string;
}) {
  const { t, i18n } = useTranslation("curriculum");
  const [open, setOpen] = useState(!hasDeadline);
  const [dueOn, setDueOn] = useState(proposedDueOn ?? "");

  if (!open) {
    return (
      <Row>
        <Button variant="quiet" onClick={() => setOpen(true)}>
          {t("deadline.move")}
        </Button>
      </Row>
    );
  }

  const hint = hasDeadline
    ? t("deadline.moveHint")
    : proposedDueOn === null
      ? t("deadline.noEstimate")
      : t("deadline.proposed", { date: formatNearDay(proposedDueOn, i18n.language) });

  return (
    <Stack gap="tight">
      <Field
        label={label}
        hint={hint}
        type="date"
        min={today}
        max={DEADLINE_LATEST}
        value={dueOn}
        onChange={(event) => setDueOn(event.target.value)}
        action={
          <Button
            variant="primary"
            disabled={dueOn === "" || control.pending}
            onClick={() => control.onCommit(dueOn)}
          >
            {hasDeadline ? t("deadline.moveAction") : t("deadline.commit")}
          </Button>
        }
      />
      {control.error === null ? null : (
        <Callout tone="danger" live>
          <Text>{control.error}</Text>
        </Callout>
      )}
    </Stack>
  );
}
