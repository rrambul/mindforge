import { useTranslation } from "react-i18next";
import { useMe } from "../features/auth/api/use-me.js";
import { InsightsRoute } from "../features/insights/routes/InsightsRoute.js";
import { useResources } from "../features/resources/api/use-resources.js";
import { Text } from "../shared/ui/index.js";

/**
 * Insights, with the profile's calendar and the names of the things in your backlog.
 *
 * Two things the feature cannot fetch for itself, both for the same reason as `ResourcesScreen`'s
 * note composer: §2.2 rule 6 forbids one feature importing another, so the screen that composes them
 * is where they meet.
 *
 * - **The calendar.** Every day and week on this screen resolves from the profile's timezone and week
 *   start (§5.2, FR-L5). Deriving them from the browser would put the grid on different days than the
 *   rollup that filled it.
 * - **Resource titles.** `/insights/backlog` reports stalled items as ids, and "three things have sat
 *   untouched for three weeks" is a fact you cannot act on until it names them.
 *
 * The route waits for the profile rather than starting on UTC and correcting: the grid's range is
 * part of its query key, so a guessed timezone means fetching a year of days twice and — for anyone
 * far enough from UTC — watching the whole grid shift a column when the real one arrives.
 */
export function InsightsScreen() {
  const { t } = useTranslation("common");
  const me = useMe(true);
  const resources = useResources({});

  if (!me.isSuccess) return <Text tone="muted">{t("state.loading")}</Text>;

  return (
    <InsightsRoute
      timezone={me.data.timezone}
      weekStartsOn={me.data.weekStartsOn}
      resourceName={(id) =>
        resources.data?.resources.find((resource) => resource.id === id)?.title ?? null
      }
    />
  );
}
