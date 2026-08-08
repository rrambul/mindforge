import { addDays, type IsoDate } from "@mindforge/core";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatDay, formatMinutes, formatPercent } from "../../../shared/lib/format.js";
import {
  Button,
  Callout,
  Card,
  CardSection,
  Figure,
  Heading,
  Label,
  Row,
  Spread,
  Stack,
  Text,
} from "../../../shared/ui/index.js";
import { usePlanVsActual, useSaveWeeklyPlan, useWeeklyPlan } from "../api/use-planning.js";
import {
  draftValue,
  orphanedAllocations,
  readDraft,
  type Draft,
  type PlanSubjectOption,
} from "../model/allocation-draft.js";
import { describeError } from "../model/describe-error.js";
import { AllocationGrid } from "../ui/AllocationGrid.js";
import { PlanRows } from "../ui/PlanRows.js";

/**
 * One week: what you are aiming at, and what actually happened (FR-F5).
 *
 * The route is smart and the components are dumb (§2.2 rule 5) — it holds the draft, decides what is
 * savable, and hands everything below it plain props.
 *
 * **`subjects` and the navigation arrive from the app layer.** The rows are every active mission plus
 * every skill, and both live in sibling features this one may not import (§2.2 rule 6); the links
 * need the route tree, which a feature has no business knowing. `WeekScreen` composes all three, the
 * way `TodayScreen` composes focus and friction.
 */
export interface WeekRouteProps {
  /** Already normalised to the first day of the week by the caller, using the profile's setting. */
  readonly weekStart: IsoDate;
  readonly subjects: readonly PlanSubjectOption[];
  readonly subjectsPending: boolean;
  /** Previous / this week / next, as links. */
  readonly nav: ReactNode;
  /** A link to this week's review. */
  readonly reviewLink?: ReactNode;
}

export function WeekRoute({
  weekStart,
  subjects,
  subjectsPending,
  nav,
  reviewLink,
}: WeekRouteProps) {
  const { t, i18n } = useTranslation("planning");
  const { t: common } = useTranslation("common");
  const locale = i18n.language;

  const plan = useWeeklyPlan(weekStart);
  const save = useSaveWeeklyPlan();

  /**
   * Only the boxes you have touched. Everything else is read from the query cache at render, so a
   * refetch is visible rather than shadowed by a copy taken on mount (§2.2 rule 1).
   *
   * Kept per week, because changing a route param does not remount the component — one flat draft
   * would carry Tuesday's unsaved edit onto next Tuesday and save it there.
   */
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  const draft = drafts[weekStart] ?? {};

  const summary = readDraft(subjects, draft, plan.data?.allocations);
  const orphans = orphanedAllocations(subjects, plan.data?.allocations);

  function edit(key: string, raw: string): void {
    setDrafts((current) => ({
      ...current,
      [weekStart]: { ...(current[weekStart] ?? {}), [key]: raw },
    }));
  }

  function submit(): void {
    save.mutate(
      { weekStart, body: summary.body },
      // Cleared only on success: a refused save leaves your typing in place to fix, and clearing it
      // would hand the boxes back to a server state that does not have your edit in it.
      { onSuccess: () => setDrafts((current) => ({ ...current, [weekStart]: {} })) },
    );
  }

  const savable =
    summary.invalidKeys.length === 0 && summary.dirty && !save.isPending && plan.isSuccess;

  return (
    <Stack>
      {nav}

      <Spread>
        <Heading level={1}>{t("week.heading", { date: formatDay(weekStart, locale) })}</Heading>
        {reviewLink}
      </Spread>

      <Card as="section" label={t("plan.heading")}>
        <Spread>
          <Label>{t("plan.heading")}</Label>
          <Figure>{formatMinutes(summary.plannedTotal, locale)}</Figure>
        </Spread>

        {plan.isError ? (
          <Callout tone="danger" live>
            <Text>{describeError(plan.error, common)}</Text>
            <Row>
              <Button onClick={() => void plan.refetch()}>{common("action.retry")}</Button>
            </Row>
          </Callout>
        ) : null}

        {plan.isPending || subjectsPending ? (
          <Text tone="muted">{common("state.loading")}</Text>
        ) : subjects.length === 0 ? (
          // Names one action rather than shrugging. There is nothing to allocate to until there is a
          // mission or a skill, and saying which is the whole content of this state.
          <Text tone="muted">{t("plan.nothingToPlan")}</Text>
        ) : (
          <>
            <AllocationGrid
              subjects={subjects}
              valueFor={(key) => draftValue(key, draft, plan.data?.allocations)}
              onChange={edit}
              invalidKeys={summary.invalidKeys}
              disabled={save.isPending}
            />

            {/* A target whose mission was parked, or whose skill was deleted, after the week was
                planned. It has no row to be edited in and the next save drops it, so it is said out
                loud instead of disappearing under a button press. */}
            {orphans.length === 0 ? null : (
              <Callout tone="warning">{t("plan.orphaned", { count: orphans.length })}</Callout>
            )}

            {save.isError ? (
              <Callout tone="danger" live>
                {describeError(save.error, common)}
              </Callout>
            ) : null}

            <Row>
              {/* The screen's one primary action (§5.3). The week navigation and the review are
                  links, because they go somewhere rather than change something. */}
              <Button variant="primary" onClick={submit} disabled={!savable}>
                {t("plan.save")}
              </Button>
              {summary.dirty ? <Text tone="hint">{t("plan.unsaved")}</Text> : null}
            </Row>
          </>
        )}
      </Card>

      <PlanVsActualCard weekStart={weekStart} />
    </Stack>
  );
}

/**
 * The comparison, as its own component reading its own query.
 *
 * Two components asking for the same key is one request — Query deduplicates — and the alternative,
 * threading the result down as props, buys nothing here and makes the parent longer than it reads.
 */
function PlanVsActualCard({ weekStart }: { readonly weekStart: IsoDate }) {
  const { t, i18n } = useTranslation("planning");
  const { t: common } = useTranslation("common");
  const locale = i18n.language;

  const actual = usePlanVsActual(weekStart);

  if (actual.isError) {
    return (
      <Callout tone="danger" live>
        <Text>{describeError(actual.error, common)}</Text>
        <Row>
          <Button onClick={() => void actual.refetch()}>{common("action.retry")}</Button>
        </Row>
      </Callout>
    );
  }

  // Absent, not empty (§5.3). A week you neither planned nor worked has no comparison to draw, and a
  // table of "0 of 0" is the manufactured block that trains you to stop looking.
  if (!actual.isSuccess || actual.data.rows.length === 0) return null;

  const { rows, plannedTotal, actualTotal, unplannedMinutes, attainment } = actual.data;

  return (
    <Card as="section" label={t("actual.heading")}>
      <Spread>
        <Label>{t("actual.heading")}</Label>
        {/* Null when the week had no plan — not 0%, and not ∞. The minutes are still real. */}
        {attainment === null ? (
          <Text as="span" tone="muted">
            {t("actual.noPlan")}
          </Text>
        ) : (
          <Figure>{formatPercent(attainment, locale)}</Figure>
        )}
      </Spread>

      <Text tone="muted">
        {t("actual.totals", {
          actual: formatMinutes(actualTotal, locale),
          planned: formatMinutes(plannedTotal, locale),
        })}
      </Text>

      {unplannedMinutes === 0 ? null : (
        <Text tone="muted">
          {t("actual.unplannedTotal", { amount: formatMinutes(unplannedMinutes, locale) })}
        </Text>
      )}

      <CardSection>
        <PlanRows rows={rows} />
      </CardSection>

      {/* The seven days this covers, stated once. A week is a calendar fact derived from the
          profile's timezone, and the range is what makes that checkable. */}
      <Text tone="hint">
        {t("actual.window", {
          from: formatDay(weekStart, locale),
          to: formatDay(addDays(weekStart, 6), locale),
        })}
      </Text>
    </Card>
  );
}
