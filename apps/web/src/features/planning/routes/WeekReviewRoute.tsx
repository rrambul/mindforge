import { addDays, dayBounds, resolveTimeZone, type IsoDate } from "@mindforge/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatDay } from "../../../shared/lib/format.js";
import {
  Button,
  Callout,
  Card,
  Heading,
  Label,
  Row,
  Spread,
  Stack,
  Text,
} from "../../../shared/ui/index.js";
import {
  useCompleteWeeklyReview,
  usePlanVsActual,
  useSaveWeeklyPlan,
  useWeeklyPlan,
  useWeeklyReviews,
} from "../api/use-planning.js";
import { useFrictionSourcesIn, useFrictionSplitIn } from "../api/use-week-friction.js";
import { describeError } from "../model/describe-error.js";
import { proposeNextWeek, splitOutcome } from "../model/review-summary.js";
import { FrictionSources } from "../ui/FrictionSources.js";
import { NextWeekOffer } from "../ui/NextWeekOffer.js";
import { PlanRows } from "../ui/PlanRows.js";
import { ReviewForm } from "../ui/ReviewForm.js";
import { SplitBar } from "../ui/SplitBar.js";

/**
 * The weekly review (FR-F6) — the ritual, and the reason M2 exists.
 *
 * REQUIREMENTS.md is blunt about why: "this is the habit loop that keeps the app alive; without a
 * ritual, tracking apps are abandoned in 3 weeks". NORTHSTAR.md §4's finish line is three of these
 * with one thing changed because of one, which is why `changedOneThing` is a first-class column and
 * not a note.
 *
 * The screen reads top to bottom as an argument: what happened, why it was hard, what you are
 * changing, what next week looks like as a result. Every block above the form is evidence and every
 * one of them is absent when it has nothing to say (§5.3) — a review padded with empty sections is a
 * review you skim.
 *
 * There is one primary action, and it is completing the review. Planning next week is offered as a
 * consequence of it rather than competing with it.
 */
export interface WeekReviewRouteProps {
  /** Already normalised to the first day of the week by the caller. */
  readonly weekStart: IsoDate;
  /** IANA, from the profile. Decides where the week's seven days begin. */
  readonly timeZone: string;
  readonly nav: ReactNode;
  /** A link to next week's grid, shown once the offer has been taken. */
  readonly nextWeekLink?: ReactNode;
}

export function WeekReviewRoute({ weekStart, timeZone, nav, nextWeekLink }: WeekReviewRouteProps) {
  const { t, i18n } = useTranslation("planning");
  const { t: common } = useTranslation("common");
  const locale = i18n.language;

  const nextWeek = addDays(weekStart, 7);

  /**
   * The instant the week began, in the profile's timezone.
   *
   * `dayBounds` rather than `${weekStart}T00:00Z`, and from `packages/core` rather than by hand: it
   * is the same function the API bounds the week with, and it is defined as a search precisely
   * because local midnight does not exist on the days Brazil and Chile moved their clocks — the
   * offset arithmetic converges on the previous evening and the two sides disagree about which day a
   * session belongs to.
   *
   * Both bounds come from the same `dayBounds` call, so the window is exactly the week: `until` is
   * the first instant of the following week and the API compares it exclusively. It was open-ended
   * when this screen first shipped, and the figures then silently included everything after the week
   * being reviewed.
   */
  const bounds = dayBounds(weekStart, resolveTimeZone(timeZone));
  const since = bounds.start.toISOString();
  const until = dayBounds(nextWeek, resolveTimeZone(timeZone)).start.toISOString();

  const actual = usePlanVsActual(weekStart);
  const sources = useFrictionSourcesIn(since, until);
  const split = useFrictionSplitIn(since, until);
  const reviews = useWeeklyReviews();
  const nextPlan = useWeeklyPlan(nextWeek);
  const complete = useCompleteWeeklyReview();
  const savePlan = useSaveWeeklyPlan();

  const existing = reviews.data?.reviews.find((review) => review.weekStart === weekStart);
  const outcome = splitOutcome(actual.data?.rows ?? []);
  const proposal = proposeNextWeek(actual.data?.rows ?? []);

  return (
    <Stack>
      {nav}

      <Heading level={1}>{t("review.heading", { date: formatDay(weekStart, locale) })}</Heading>

      {actual.isError ? (
        <Callout tone="danger" live>
          <Text>{describeError(actual.error, common)}</Text>
          <Row>
            <Button onClick={() => void actual.refetch()}>{common("action.retry")}</Button>
          </Row>
        </Callout>
      ) : null}

      {actual.isPending ? <Text tone="muted">{common("state.loading")}</Text> : null}

      {/* Worked on, and planned. The delta on each row is the interesting part — hitting a target
          and doubling it are both "moved", and only one of them means the plan was right. */}
      {outcome.moved.length === 0 ? null : (
        <Card as="section" label={t("review.moved")}>
          <Label>{t("review.moved")}</Label>
          <PlanRows rows={outcome.moved} />
        </Card>
      )}

      {/* Planned and untouched. Zero here is a measurement and the rows show it as one. */}
      {outcome.stalled.length === 0 ? null : (
        <Card as="section" label={t("review.stalled")}>
          <Label>{t("review.stalled")}</Label>
          <PlanRows rows={outcome.stalled} />
        </Card>
      )}

      {/* Hours that went somewhere you never wrote down. Half of what the ritual is for is noticing
          these, which is why they are their own block rather than a footnote to the plan. */}
      {outcome.unplanned.length === 0 ? null : (
        <Card as="section" label={t("review.unplannedHeading")}>
          <Label>{t("review.unplannedHeading")}</Label>
          <PlanRows rows={outcome.unplanned} />
        </Card>
      )}

      {sources.data === undefined || sources.data.eventCount === 0 ? null : (
        <Card as="section" label={t("review.friction")}>
          <Spread>
            <Label>{t("review.friction")}</Label>
          </Spread>
          <FrictionSources sources={sources.data} />
          {/* The window, stated. The endpoint has no upper bound, so calling this "the week's
              friction" would be a claim the request cannot support. */}
          <Text tone="hint">
            {t("review.frictionWindow", {
              from: formatDay(weekStart, locale),
              to: formatDay(addDays(weekStart, 6), locale),
            })}
          </Text>
        </Card>
      )}

      {/* Absent when no friction was logged at all, and *present* when some was logged but none of it
          could be attributed — those are two different facts and only the second is worth a sentence.
          "Unmeasured, not zero" explains a null share; printed over a week nobody tapped a chip in, it
          would be the manufactured block §5.3 rules out. */}
      {split.data === undefined || split.data.eventCount === 0 ? null : (
        <Card as="section" label={t("review.split")}>
          <Label>{t("review.split")}</Label>
          <SplitBar split={split.data} />
          <Text tone="hint">
            {t("review.frictionWindow", {
              from: formatDay(weekStart, locale),
              to: formatDay(addDays(weekStart, 6), locale),
            })}
          </Text>
        </Card>
      )}

      <Card as="section" label={t("review.oneThing")}>
        <Label>{t("review.oneThing")}</Label>
        {/* Not drawn until the stored review is known. `POST /reviews/weekly/:weekStart` is an
            idempotent upsert, so a form rendered empty while the list is in flight is one Complete
            away from erasing the sentence you wrote last time — and the failure is silent, because
            the request succeeds. An error is different from a wait: the list not loading is no reason
            to stop you writing a review, so only `isPending` holds the form back. */}
        {reviews.isPending ? (
          <Text tone="muted">{common("state.loading")}</Text>
        ) : (
          <ReviewForm
            existing={existing}
            timeZone={timeZone}
            pending={complete.isPending}
            error={complete.error === null ? null : describeError(complete.error, common)}
            onSubmit={(input) => complete.mutate({ weekStart, body: input })}
          />
        )}
      </Card>

      {proposal.rows.length === 0 ? null : (
        <Card as="section" label={t("next.heading")}>
          <Spread>
            <Label>{t("next.heading")}</Label>
            <Text as="span" tone="muted">
              {t("next.week", { date: formatDay(nextWeek, locale) })}
            </Text>
          </Spread>
          <Text tone="muted">{t("next.explain")}</Text>
          <NextWeekOffer
            proposal={proposal}
            alreadyPlannedMinutes={nextPlan.data?.plannedTotal ?? 0}
            pending={savePlan.isPending}
            saved={savePlan.isSuccess && savePlan.variables.weekStart === nextWeek}
            error={savePlan.error === null ? null : describeError(savePlan.error, common)}
            onApply={() => savePlan.mutate({ weekStart: nextWeek, body: proposal.body })}
            link={nextWeekLink}
          />
        </Card>
      )}
    </Stack>
  );
}
