import { addDays } from "@mindforge/core";
import { useTranslation } from "react-i18next";
import { useMe } from "../features/auth/api/use-me.js";
import { WeekReviewRoute } from "../features/planning/routes/WeekReviewRoute.js";
import { Row, Text } from "../shared/ui/index.js";
import { RouterLink } from "../shared/ui/RouterLink.js";
import { resolveWeek, todayWeek, useWeekParam, WeekNav, weekPath } from "./WeekScreen.js";

/**
 * `/weeks/$weekStart/review` — the weekly review ritual (FR-F6).
 *
 * Thin, like every screen in `app/`: it resolves which week the URL is about from the profile, draws
 * the links a feature has no way to build, and hands the rest to `WeekReviewRoute`. The week
 * navigation is the same component the planning screen uses, so the two screens cannot drift into
 * two different ways of moving between weeks.
 */
export function WeekReviewScreen() {
  const { t } = useTranslation("planning");
  const { t: common } = useTranslation("common");

  const me = useMe(true);
  const requested = useWeekParam();

  if (!me.isSuccess) {
    return <Text tone="muted">{common("state.loading")}</Text>;
  }

  const weekStart = resolveWeek(requested, me.data.timezone, me.data.weekStartsOn);

  return (
    <WeekReviewRoute
      weekStart={weekStart}
      timeZone={me.data.timezone}
      nav={
        <Row>
          {/* Back to the week itself first: the review is a screen you arrive at *from* the plan,
              and the grid is where a decision made here is acted on. */}
          <RouterLink to={weekPath(weekStart)} exact>
            {t("nav.backToWeek")}
          </RouterLink>
          <WeekNav
            weekStart={weekStart}
            today={todayWeek(me.data.timezone, me.data.weekStartsOn)}
          />
        </Row>
      }
      nextWeekLink={
        <RouterLink to={weekPath(addDays(weekStart, 7))} exact>
          {t("next.open")}
        </RouterLink>
      }
    />
  );
}
