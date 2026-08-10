import type { WeekStart } from "@mindforge/core";
import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import { Button, Callout, Card, Heading, Row, Stack, Text } from "../../../shared/ui/index.js";
import { useActivityGrid } from "../api/use-insights.js";
import { insightsWindow } from "../model/window.js";
import { ActivityPanel } from "../ui/ActivityPanel.js";

/**
 * Insights (FR-Q1) — the frequency tracker: the year of days, and whether you keep showing up.
 *
 * Every derived number on the screen was computed by `packages/core` on the server; nothing here
 * recomputes one, because a figure that disagreed with the API would break the product's central
 * promise (non-negotiable 3).
 *
 * §5.1 files insights under desktop-first, and that is why the grid gets a scroll container instead
 * of a smaller year: comparison needs pixels, so mobile gets a reduced view of the same data rather
 * than a squeezed one.
 */
export interface InsightsRouteProps {
  /** IANA, from the profile. "Today" is resolved from it, never from the browser (§5.2). */
  readonly timezone: string;
  /** Owned by the user, never re-derived from the locale at render (FR-L4). */
  readonly weekStartsOn: WeekStart;
}

export function InsightsRoute({ timezone, weekStartsOn }: InsightsRouteProps) {
  const { t } = useTranslation("insights");

  // One reading of the clock per timezone. Recomputing the range on every render would mint a new
  // query key on every render, and the grid would refetch for as long as the screen was open.
  const span = useMemo(() => insightsWindow(timezone), [timezone]);

  const grid = useActivityGrid({ from: span.gridFrom, to: span.gridTo });

  return (
    <Stack gap="loose">
      <Heading level={1}>{t("heading")}</Heading>

      <Card as="section" label={t("grid.heading")}>
        <Heading level={2}>{t("grid.heading")}</Heading>

        <Loaded query={grid}>
          {(data) => <ActivityPanel grid={data} weekStartsOn={weekStartsOn} timezone={timezone} />}
        </Loaded>
      </Card>
    </Stack>
  );
}

/**
 * Loading and failure, written once.
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
