import type { GridSignal, WeekStart } from "@mindforge/core";
import { useTranslation } from "react-i18next";
import { formatInstant, formatWeekday } from "../../../shared/lib/format.js";
import { Callout, Figure, Label, Spread, Stack, Text } from "../../../shared/ui/index.js";
import type { ActivityGridResponse } from "../api/use-insights.js";
import { ActivityHeatmap, HeatmapLegend } from "./ActivityHeatmap.js";

interface ActivityPanelProps {
  readonly grid: ActivityGridResponse;
  readonly weekStartsOn: WeekStart;
  /** IANA, from the profile. Only `rebuiltAt` needs it — every other date here is a wall date. */
  readonly timezone: string;
}

/**
 * The grid, the figure that stands beside it, and at most one sentence.
 *
 * The figure is **active days in the last 28**, never a streak (FR-N5). A counter that resets to
 * zero is a punishment, punishment produces gaming, and gaming corrupts the one dataset this product
 * exists to collect — so there is no counter here that one bad week can break.
 */
export function ActivityPanel({ grid, weekStartsOn, timezone }: ActivityPanelProps) {
  const { t, i18n } = useTranslation("insights");

  return (
    <Stack>
      <Spread>
        <Label>{t("grid.activeDaysLabel")}</Label>
        <Figure>{t("grid.activeDays", { count: grid.activeDaysIn28 })}</Figure>
      </Spread>
      <Text tone="hint">{t("grid.activeDaysHint")}</Text>

      <ActivityHeatmap cells={grid.cells} layer={grid.layer} weekStartsOn={weekStartsOn} />
      <HeatmapLegend layer={grid.layer} />

      <GridSignalLine signal={grid.signal} />

      {/* A stale grid and an empty grid look identical without this, and the nightly rollup is the
          thing most likely to fail quietly. */}
      <Text tone="hint">
        {grid.rebuiltAt === null
          ? t("grid.neverRolledUp")
          : t("grid.rebuiltAt", {
              when: formatInstant(grid.rebuiltAt, i18n.language, timezone),
            })}
      </Text>
    </Stack>
  );
}

/**
 * The one derived line, and nothing at all when there is not one.
 *
 * Null is the common case and rendering a placeholder for it would be the worst available outcome:
 * §5.3 is explicit that a manufactured insight trains you to stop reading them, and the whole value
 * of this line is that it only appears when it is true.
 */
function GridSignalLine({ signal }: { readonly signal: GridSignal }) {
  const { t, i18n } = useTranslation("insights");

  if (signal === null) return null;

  return (
    <Callout>
      <Text>
        {signal.kind === "never_on_weekday"
          ? t("grid.signal.neverOnWeekday", {
              weekday: formatWeekday(signal.weekday, i18n.language),
            })
          : t("grid.signal.paceBelowPlan", {
              average: signal.averageActiveDays,
              planned: signal.plannedDays,
            })}
      </Text>
    </Callout>
  );
}
