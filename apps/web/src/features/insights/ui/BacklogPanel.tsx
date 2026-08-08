import type { BacklogSignal } from "@mindforge/core";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { formatDay, formatPercent } from "../../../shared/lib/format.js";
import {
  Callout,
  Card,
  CardSection,
  ChipList,
  Figure,
  Heading,
  Label,
  Stack,
  StatusChip,
  Text,
} from "../../../shared/ui/index.js";
import type { BacklogResponse } from "../api/use-insights.js";
import "./insights.css";

interface BacklogPanelProps {
  readonly backlog: BacklogResponse;
  /**
   * A stalled item's title, supplied by the app layer.
   *
   * `/insights/backlog` answers with resource ids and no titles, and `features/insights` may not
   * reach into `features/resources` to look them up (§2.2 rule 6) — so the screen that composes both
   * hands the lookup in, the same way a resource card gets its note composer.
   */
  readonly resourceName?: (id: string) => string | null;
}

/**
 * Queue growth against throughput, what is stalled, and what you quit (FR-I7).
 *
 * Two of the figures here are nullable and both nulls mean "there was nothing to measure", not zero:
 * `medianOpenAgeDays` is null when nothing is open, and `abandonmentRate` is null for two different
 * reasons that this panel keeps apart — nothing resolved in the window, or abandonments that carry no
 * date and therefore cannot be placed in one. A 0% abandonment rate would read as "you never quit
 * anything", which for most users is the opposite of true.
 */
export function BacklogPanel({ backlog, resourceName }: BacklogPanelProps) {
  const { t, i18n } = useTranslation("insights");
  const locale = i18n.language;

  return (
    <Card as="section" label={t("backlog.heading")}>
      <Heading level={2}>{t("backlog.heading")}</Heading>
      <Text tone="muted">{t("backlog.window", { days: backlog.windowDays })}</Text>

      <div className="mf-figure-pair">
        <div>
          <Label>{t("backlog.added")}</Label>
          <Figure>{backlog.added}</Figure>
        </div>
        <div>
          <Label>{t("backlog.resolved")}</Label>
          <Figure>{backlog.resolved}</Figure>
        </div>
        <div>
          <Label>{t("backlog.open")}</Label>
          <Figure>{backlog.openCount}</Figure>
        </div>
      </div>

      <Text>
        {backlog.netChange > 0
          ? t("backlog.grew", { count: backlog.netChange })
          : backlog.netChange < 0
            ? t("backlog.shrank", { count: -backlog.netChange })
            : t("backlog.held")}
      </Text>

      {/* Null age is "nothing is open", which is a fine state to be in and a terrible one to draw as
          a zero-day-old queue. */}
      <Text tone="muted">
        {backlog.oldestOpenDays === null || backlog.medianOpenAgeDays === null
          ? t("backlog.nothingOpen")
          : t("backlog.ages", {
              oldest: backlog.oldestOpenDays,
              median: backlog.medianOpenAgeDays,
            })}
      </Text>

      <CardSection label={t("backlog.stalled.label")}>
        <Text tone="hint">{t("backlog.stalled.explain")}</Text>
        {backlog.stalled.length === 0 ? (
          <Text tone="muted">{t("backlog.stalled.none")}</Text>
        ) : (
          <Stack gap="tight">
            {backlog.stalled.map((item) => (
              <div key={item.id}>
                <Text>
                  {t("backlog.stalled.row", {
                    name: resourceName?.(item.id) ?? t("backlog.stalled.unnamed"),
                    days: item.untouchedDays,
                  })}
                </Text>
                <Text tone="hint">
                  {item.lastTouchedOn === null
                    ? t("backlog.stalled.neverTouched")
                    : t("backlog.stalled.lastTouched", {
                        date: formatDay(item.lastTouchedOn, locale),
                      })}
                </Text>
              </div>
            ))}
          </Stack>
        )}
      </CardSection>

      <CardSection label={t("backlog.abandonment.label")}>
        <Text>{rateSentence(backlog, locale, t)}</Text>

        {backlog.abandonment.total === 0 ? null : (
          <>
            {/* All-time, and labelled as such: `resources` records *that* you abandoned something and
                never *when*, so there is no honest way to put these inside the window. */}
            <Text tone="hint">{t("backlog.abandonment.allTime")}</Text>
            {backlog.abandonment.reasons.length === 0 ? (
              <Text tone="muted">{t("backlog.abandonment.noReasons")}</Text>
            ) : (
              <ChipList label={t("backlog.abandonment.label")}>
                {backlog.abandonment.reasons.map((reason) => (
                  <li key={reason.reason}>
                    <StatusChip>
                      {t("backlog.abandonment.reason", {
                        reason: reason.reason,
                        count: reason.count,
                      })}
                    </StatusChip>
                  </li>
                ))}
              </ChipList>
            )}
            <Text tone="hint">{t("backlog.abandonment.bounds")}</Text>
          </>
        )}
      </CardSection>

      <BacklogSignalLine signal={backlog.signal} windowDays={backlog.windowDays} />
    </Card>
  );
}

/**
 * The rate, or which of the two reasons it cannot be one.
 *
 * The API collapses both into `null`, and the client can tell them apart because the abandonment
 * count travels beside it. Collapsing them here too would be the honest-looking version of the
 * dishonest thing: "no rate" without a reason reads as a bug.
 */
function rateSentence(backlog: BacklogResponse, locale: string, t: TFunction<"insights">): string {
  if (backlog.abandonmentRate !== null) {
    return t("backlog.abandonment.rate", {
      rate: formatPercent(backlog.abandonmentRate, locale),
      abandoned: backlog.abandoned,
      resolved: backlog.resolved,
    });
  }
  return backlog.abandonment.total > 0
    ? t("backlog.abandonment.undated", { total: backlog.abandonment.total })
    : t("backlog.abandonment.nothingResolved", { days: backlog.windowDays });
}

/** One sentence, and nothing when there is nothing worth one. */
function BacklogSignalLine({
  signal,
  windowDays,
}: {
  readonly signal: BacklogSignal;
  readonly windowDays: number;
}) {
  const { t } = useTranslation("insights");

  if (signal === null) return null;

  return (
    <Callout tone="warning">
      <Text>
        {signal.kind === "growing"
          ? t("backlog.signal.growing", {
              added: signal.added,
              resolved: signal.resolved,
              days: windowDays,
            })
          : signal.kind === "stalling"
            ? t("backlog.signal.stalling", { count: signal.count, days: signal.days })
            : t("backlog.signal.aging", { days: signal.days })}
      </Text>
    </Callout>
  );
}
