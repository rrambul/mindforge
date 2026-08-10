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
  /**
   * "Teach me the next thing" for this mission (FR-T3), from the app layer too.
   *
   * Above the note rather than below it: teaching is what a mission is *for*, and
   * a card that leads with a note composer buries the thing the learner came for.
   */
  readonly teach?: ReactNode;
  /**
   * The way in to this mission's curriculum (FR-K5), from the app layer.
   *
   * A slot for the same reason `teach` is one, plus a second: it is a router
   * link, and the route it points at is the app's composition rather than
   * something a dumb card should name. Handing it in keeps this component — and
   * every test that renders it — free of a router.
   */
  readonly curriculum?: ReactNode;
}

/**
 * Dumb by design (§2.2 rule 5): props in, markup out, no fetching. The route decides what happens
 * when you park something.
 */
export function MissionCard({
  mission,
  onTogglePark,
  pending,
  note,
  teach,
  curriculum,
}: MissionCardProps) {
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

      {/* Shown on a parked mission too: the plan is still worth reading when you
          are not working on it. */}
      {curriculum ? <Row>{curriculum}</Row> : null}

      {/* Not on a parked mission: parking is a statement that you are not working
          on something, and offering to teach it is the same contradiction
          `MissionParked` refuses for a weekly allocation (FR-M4b). */}
      {!parked && teach}

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
