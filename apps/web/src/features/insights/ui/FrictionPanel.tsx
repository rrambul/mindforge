import { useTranslation } from "react-i18next";
import { Card, CardSection, Heading, Stack, Text } from "../../../shared/ui/index.js";
import type { FrictionResponse } from "../api/use-insights.js";
import { Meter } from "./Meter.js";

interface FrictionPanelProps {
  readonly friction: FrictionResponse;
  readonly windowDays: number;
}

/**
 * Where the friction is (FR-I3).
 *
 * `/friction/summary` already answers the ember/slag split; this is the other half the weekly review
 * turns on — which types, and on which missions.
 *
 * **Unattributed friction is a row, not an omission.** Friction rows carry no `mission_id` — mission
 * is reachable only through a focus session — so a standalone tap genuinely has no mission, and the
 * API says so rather than dropping it. Hiding it here would make the mission bars above look like the
 * whole story while the counts quietly failed to add up, and FR-C1 calls the standalone tap the escape
 * hatch for the friction you hit between blocks: it is a fact about the day, not a gap in the data.
 */
export function FrictionPanel({ friction, windowDays }: FrictionPanelProps) {
  const { t } = useTranslation("insights");
  const { t: types } = useTranslation("friction");

  const topType = friction.byType[0]?.count ?? 0;
  // The unattributed row competes with the missions for the longest bar, so it is part of the scale.
  const topSubject = Math.max(friction.byMission[0]?.count ?? 0, friction.unattributed.total);

  return (
    <Card as="section" label={t("friction.heading")}>
      <Heading level={2}>{t("friction.heading")}</Heading>
      <Text tone="muted">{t("friction.window", { days: windowDays })}</Text>

      {friction.eventCount === 0 ? (
        // Nothing logged is an absence, not a score of zero: a screen of empty bars would claim the
        // last four weeks were frictionless, which nothing has established.
        <Text tone="muted">{t("friction.none", { days: windowDays })}</Text>
      ) : (
        <>
          <CardSection label={t("friction.byType")}>
            <Stack gap="tight">
              {friction.byType.map((row) => (
                <Meter
                  key={row.type}
                  label={types(`type.${row.type}`)}
                  value={row.count}
                  max={topType}
                  hint={t("friction.meanIntensity", { intensity: row.meanIntensity })}
                />
              ))}
            </Stack>
          </CardSection>

          <CardSection label={t("friction.byMission")}>
            <Stack gap="tight">
              {friction.byMission.map((row) => (
                <Meter key={row.missionId} label={row.topic} value={row.count} max={topSubject} />
              ))}

              {friction.unattributed.total === 0 ? null : (
                <Meter
                  label={t("friction.unattributed")}
                  value={friction.unattributed.total}
                  max={topSubject}
                  variant="unattributed"
                  hint={t("friction.unattributedSplit", {
                    standalone: friction.unattributed.standalone,
                    inSession: friction.unattributed.sessionWithoutMission,
                  })}
                />
              )}

              {friction.byMission.length === 0 ? (
                <Text tone="muted">{t("friction.noMissions")}</Text>
              ) : null}
            </Stack>
          </CardSection>
        </>
      )}
    </Card>
  );
}
