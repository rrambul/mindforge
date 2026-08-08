import {
  addDays,
  isIsoDate,
  localDay,
  resolveTimeZone,
  startOfWeek,
  type IsoDate,
} from "@mindforge/core";
import { useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMe } from "../features/auth/api/use-me.js";
import { useMissions } from "../features/missions/api/use-missions.js";
import type { PlanSubjectOption } from "../features/planning/model/allocation-draft.js";
import { ThisWeekBlock } from "../features/planning/routes/ThisWeekBlock.js";
import { WeekRoute } from "../features/planning/routes/WeekRoute.js";
import { useSkills } from "../features/skills/api/use-skills.js";
import { now } from "../shared/lib/clock.js";
import { Row, Text } from "../shared/ui/index.js";
import { RouterLink } from "../shared/ui/RouterLink.js";

/**
 * `/weeks/$weekStart` — the weekly planning grid (FR-F5).
 *
 * Composed here rather than inside `features/planning`, because the grid's rows are every active
 * mission plus every skill and those live in two sibling features the planning slice may not import
 * (§2.2 rule 6). Same reason `TodayScreen` exists: the route is what joins features, and the
 * alternative is `planning` importing `missions`, which is the first step toward the refactor the
 * boundary exists to prevent.
 *
 * **Parked missions are absent**, because `PUT /plans/:weekStart` refuses them (§5.3) — offering a
 * box that cannot be saved would be a form that lies about what it accepts.
 */
export function WeekScreen() {
  const { t: common } = useTranslation("common");

  const me = useMe(true);
  const missions = useMissions("active");
  const skills = useSkills({});
  const requested = useWeekParam();

  if (!me.isSuccess) {
    // The week cannot be resolved without `weekStartsOn`, and guessing it would put the whole screen
    // on the wrong seven days — which is worse than a moment of "Loading" (FR-L5).
    return <Text tone="muted">{common("state.loading")}</Text>;
  }

  const weekStart = resolveWeek(requested, me.data.timezone, me.data.weekStartsOn);

  const subjects: PlanSubjectOption[] = [
    ...(missions.data?.missions ?? []).map((mission) => ({
      kind: "mission" as const,
      id: mission.id,
      label: mission.topic,
    })),
    ...(skills.data?.skills ?? []).map((skill) => ({
      kind: "skill" as const,
      id: skill.id,
      label: skill.name,
    })),
    // Sorted by name inside each group, which `AllocationGrid` splits them into. The grid is read
    // every week and a row that moves because a mission was touched yesterday is a row you have to
    // find again — findability beats recency for a form you fill in from memory.
  ].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <WeekRoute
      weekStart={weekStart}
      subjects={subjects}
      subjectsPending={missions.isPending || skills.isPending}
      nav={
        <WeekNav weekStart={weekStart} today={todayWeek(me.data.timezone, me.data.weekStartsOn)} />
      }
      reviewLink={<ReviewLink weekStart={weekStart} />}
    />
  );
}

/**
 * The week in the address bar, or null when there is none.
 *
 * `strict: false` because this component is also rendered by `/weeks/$weekStart/review`'s sibling in
 * tests and by the not-found fallback; a strict lookup throws when the param is absent rather than
 * letting the screen fall back to the current week.
 */
export function useWeekParam(): string | null {
  const params: Record<string, string | undefined> = useParams({ strict: false });
  return params["weekStart"] ?? null;
}

/**
 * Which week the screen is about.
 *
 * Normalised with `startOfWeek` from `packages/core` — the same function the API normalises with, so
 * the client cannot ask for one week and label it another (non-negotiable 3). A param that is not a
 * date at all falls back to the current week rather than erroring: a typo in a bookmark is not worth
 * a full-page failure, and the heading says which week you actually got.
 */
export function resolveWeek(
  requested: string | null,
  timezone: string,
  weekStartsOn: 0 | 1,
): IsoDate {
  const candidate = requested !== null && isIsoDate(requested) ? requested : todayIn(timezone);
  return startOfWeek(candidate, weekStartsOn);
}

function todayIn(timezone: string): IsoDate {
  return localDay(now(), resolveTimeZone(timezone));
}

export function todayWeek(timezone: string, weekStartsOn: 0 | 1): IsoDate {
  return startOfWeek(todayIn(timezone), weekStartsOn);
}

export function weekPath(weekStart: IsoDate): string {
  return `/weeks/${weekStart}`;
}

export function reviewPath(weekStart: IsoDate): string {
  return `/weeks/${weekStart}/review`;
}

/**
 * Previous, this week, next — as links, not buttons.
 *
 * A week is a thing you bookmark and send to yourself, which is the whole reason the route carries
 * the date rather than the screen holding an offset in state. Buttons would take middle-click,
 * ⌘-click and "copy link address" away from the one screen whose address is the feature.
 *
 * Exported so the review screen can render the same bar without a third file in `app/`.
 */
export function WeekNav({
  weekStart,
  today,
}: {
  readonly weekStart: IsoDate;
  readonly today: IsoDate;
}) {
  const { t } = useTranslation("planning");

  return (
    <Row>
      <RouterLink to={weekPath(addDays(weekStart, -7))} exact>
        {t("nav.previous")}
      </RouterLink>
      {/* Absent when you are already looking at it: a link to where you are is a control that does
          nothing, and §5.3's rule about empty blocks is the same rule one size down. */}
      {weekStart === today ? null : (
        <RouterLink to={weekPath(today)} exact>
          {t("nav.thisWeek")}
        </RouterLink>
      )}
      <RouterLink to={weekPath(addDays(weekStart, 7))} exact>
        {t("nav.next")}
      </RouterLink>
    </Row>
  );
}

function ReviewLink({ weekStart }: { readonly weekStart: IsoDate }) {
  const { t } = useTranslation("planning");
  return <RouterLink to={reviewPath(weekStart)}>{t("nav.review")}</RouterLink>;
}

/**
 * Today's `THIS WEEK` block, ready to drop into `TodayScreen` (§5.3).
 *
 * Props-free on purpose. Which week "this week" is depends on the profile's `weekStartsOn` and its
 * timezone, so the alternative is `TodayScreen` growing a `useMe`, two date calls and a link builder
 * for a block it does not own — and `planning` cannot reach for `auth` itself (§2.2 rule 6). This is
 * the seam: `app/` knows both, and Today renders one element.
 *
 * Nothing at all until the profile is known. Today's first pixel is information and its budget is
 * ≤5s to a started session (§7.1); a placeholder for a block that may have nothing to say is a
 * spinner on the one screen that must not have one.
 */
export function TodayThisWeek() {
  const { t } = useTranslation("planning");
  const me = useMe(true);

  if (!me.isSuccess) return null;

  const weekStart = todayWeek(me.data.timezone, me.data.weekStartsOn);

  return (
    <ThisWeekBlock
      weekStart={weekStart}
      timeZone={me.data.timezone}
      link={
        <RouterLink to={weekPath(weekStart)} exact>
          {t("thisWeek.open")}
        </RouterLink>
      }
    />
  );
}
