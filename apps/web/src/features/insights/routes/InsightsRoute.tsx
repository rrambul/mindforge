import { GRID_LAYERS, type GridLayer, type WeekStart } from "@mindforge/core";
import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import {
  Button,
  Callout,
  Card,
  Heading,
  Row,
  Select,
  Stack,
  Text,
} from "../../../shared/ui/index.js";
import { useActivityGrid, useBacklogHealth, useFrictionAnalytics } from "../api/use-insights.js";
import { insightsWindow } from "../model/window.js";
import { ActivityPanel } from "../ui/ActivityPanel.js";
import { BacklogPanel } from "../ui/BacklogPanel.js";
import { FrictionPanel } from "../ui/FrictionPanel.js";

/**
 * Insights (FR-I3, FR-I6b, FR-I7) — the year, the queue, and where the friction is.
 *
 * Three panels that each read one endpoint, in the order they are worth reading: the grid answers
 * "did I show up", the backlog answers "what am I carrying", and friction answers "what is in the
 * way". Every derived number on the screen was computed by `packages/core` on the server; nothing
 * here recomputes one, because a gauge that disagreed with the API about a score would break the
 * product's central promise (non-negotiable 3).
 *
 * §5.1 files insights under desktop-first, and that is why the grid gets a scroll container instead
 * of a smaller year: comparison needs pixels, so mobile gets a reduced view of the same data rather
 * than a squeezed one.
 */
export interface InsightsRouteProps {
  /** IANA, from the profile. "Today" is resolved from it, never from the browser (§5.2). */
  readonly timezone: string;
  /** Owned by the user, never re-derived from the locale at render (FR-L5). */
  readonly weekStartsOn: WeekStart;
  /**
   * Names a stalled resource, supplied by the app layer.
   *
   * The backlog endpoint answers with ids; the titles live in `features/resources`, which this
   * feature may not import (§2.2 rule 6). Optional, so the route renders without it.
   */
  readonly resourceName?: (id: string) => string | null;
}

export function InsightsRoute({ timezone, weekStartsOn, resourceName }: InsightsRouteProps) {
  const { t } = useTranslation("insights");
  const [layer, setLayer] = useState<GridLayer>("focus");

  // One reading of the clock per timezone. Recomputing the range on every render would mint a new
  // query key on every render, and the grid would refetch for as long as the screen was open.
  const span = useMemo(() => insightsWindow(timezone), [timezone]);

  const grid = useActivityGrid({ from: span.gridFrom, to: span.gridTo, layer });
  const backlog = useBacklogHealth();
  const friction = useFrictionAnalytics(span.frictionSince);

  return (
    <Stack gap="loose">
      <Heading level={1}>{t("heading")}</Heading>

      <Card as="section" label={t("grid.heading")}>
        <Heading level={2}>{t("grid.heading")}</Heading>

        {/* Exactly the layers that have a source. §3.9 names five; reviews, lessons and artifacts
            have no table until M4–M6, and a switcher offering options that are flat by construction
            teaches you the grid is decoration. `GRID_LAYERS` is the two that exist, and the API
            answers 422 for anything else — so there is nothing to disable here. */}
        <Select
          label={t("grid.layerLabel")}
          value={layer}
          onChange={(event) => setLayer(event.target.value as GridLayer)}
          options={GRID_LAYERS.map((option) => ({
            value: option,
            label: t(`layer.${option}`),
          }))}
        />

        <Loaded query={grid}>
          {(data) => <ActivityPanel grid={data} weekStartsOn={weekStartsOn} timezone={timezone} />}
        </Loaded>
      </Card>

      <Loaded query={backlog}>
        {(data) => (
          <BacklogPanel backlog={data} {...(resourceName === undefined ? {} : { resourceName })} />
        )}
      </Loaded>

      <Loaded query={friction}>
        {(data) => <FrictionPanel friction={data} windowDays={span.windowDays} />}
      </Loaded>
    </Stack>
  );
}

/**
 * Loading and failure, written once for three queries.
 *
 * Each panel fails on its own rather than the screen failing as a whole: the three endpoints are
 * independent, and a backlog query that 500s should not take the year of days down with it.
 */
function Loaded<T>({
  query,
  children,
}: {
  readonly query: UseQueryResult<T>;
  readonly children: (data: T) => ReactNode;
}) {
  const { t: common } = useTranslation("common");

  if (query.isError) {
    return (
      <Callout tone="danger" live>
        <Text>{describe(query.error, common)}</Text>
        <Row>
          <Button onClick={() => void query.refetch()}>{common("action.retry")}</Button>
        </Row>
      </Callout>
    );
  }

  if (!query.isSuccess) return <Text tone="muted">{common("state.loading")}</Text>;

  return <>{children(query.data)}</>;
}

function describe(error: unknown, common: (key: string) => string): string {
  if (error instanceof NetworkError) return common("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return common("error.unexpectedBody");
}
