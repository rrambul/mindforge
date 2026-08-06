import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Heading, Row, Spread, StatusChip, Text } from "../../../shared/ui/index.js";
import type { Mission } from "../api/use-missions.js";

interface MissionCardProps {
  readonly mission: Mission;
  readonly onTogglePark: (mission: Mission) => void;
  readonly pending: boolean;
  /**
   * A note composer for this mission, supplied by the app layer (M1's "notes on anything").
   *
   * A slot rather than an import: §2.2 rule 6 stops this feature reaching into notes, so the screen
   * that composes both hands it in. Optional, so the card still renders in a test that does not care.
   */
  readonly note?: ReactNode;
}

/**
 * Dumb by design (§2.2 rule 5): props in, markup out, no fetching. The route decides what happens
 * when you park something.
 */
export function MissionCard({ mission, onTogglePark, pending, note }: MissionCardProps) {
  const { t } = useTranslation("missions");
  const { t: g } = useTranslation("glossary");

  const parked = mission.status === "parked";
  const canToggle = mission.status === "active" || parked;

  return (
    // Dimmer, not hidden: parked knowledge is still knowledge (§5.3).
    <Card as="article" variant={parked ? "muted" : "raised"}>
      <Spread>
        <Heading level={2}>{mission.topic}</Heading>
        {/* A key, translated at render — the column stores `parked` (§5.2). */}
        <StatusChip>{g(`missionStatus.${mission.status}`)}</StatusChip>
      </Spread>

      {/* The "why" is what every later feature reads, so it is shown rather than hidden behind a
          detail view — and its absence is stated rather than left as empty space, because a mission
          without one is worth noticing. */}
      {mission.why ? <Text>{mission.why}</Text> : <Text tone="hint">{t("card.noWhy")}</Text>}

      {note}

      {canToggle ? (
        <Row>
          <Button onClick={() => onTogglePark(mission)} disabled={pending}>
            {pending
              ? t(parked ? "card.unparking" : "card.parking")
              : t(parked ? "card.unpark" : "card.park")}
          </Button>
        </Row>
      ) : null}
    </Card>
  );
}
