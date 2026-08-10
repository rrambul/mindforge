import { useTranslation } from "react-i18next";
import { useMe } from "../features/auth/api/use-me.js";
import { InsightsRoute } from "../features/insights/routes/InsightsRoute.js";
import { Text } from "../shared/ui/index.js";

/**
 * Insights, with the profile's calendar.
 *
 * **The calendar** is the thing the feature cannot fetch for itself: every day and week on this
 * screen resolves from the profile's timezone and week start (§5.2, FR-L4). Deriving them from the
 * browser would put the grid on different days than the rollup that filled it.
 *
 * The route waits for the profile rather than starting on UTC and correcting: the grid's range is
 * part of its query key, so a guessed timezone means fetching a year of days twice and — for anyone
 * far enough from UTC — watching the whole grid shift a column when the real one arrives.
 */
export function InsightsScreen() {
  const { t } = useTranslation("common");
  const me = useMe(true);

  if (!me.isSuccess) return <Text tone="muted">{t("state.loading")}</Text>;

  return <InsightsRoute timezone={me.data.timezone} weekStartsOn={me.data.weekStartsOn} />;
}
