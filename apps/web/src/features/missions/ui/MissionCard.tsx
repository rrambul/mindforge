import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button.js";
import type { Mission } from "../api/use-missions.js";

interface MissionCardProps {
  readonly mission: Mission;
  readonly onTogglePark: (mission: Mission) => void;
  readonly pending: boolean;
}

/**
 * Dumb by design (§2.2 rule 5): props in, markup out, no fetching. The route decides
 * what happens when you park something.
 */
export function MissionCard({ mission, onTogglePark, pending }: MissionCardProps) {
  const { t } = useTranslation("missions");
  const { t: g } = useTranslation("glossary");

  const parked = mission.status === "parked";
  const canToggle = mission.status === "active" || parked;

  return (
    <article className={parked ? "mf-card mf-card--parked" : "mf-card"}>
      <div className="mf-spread">
        <h2 className="mf-h2">{mission.topic}</h2>
        {/* A key, translated at render — the column stores `parked` (§5.2). */}
        <span className="mf-chip">{g(`missionStatus.${mission.status}`)}</span>
      </div>

      {/* The "why" is the thing every later feature reads, so it is shown rather than
          hidden behind a detail view — and its absence is stated rather than left as
          empty space, because a mission without one is worth noticing. */}
      <p className={mission.why ? undefined : "mf-hint"}>{mission.why ?? t("card.noWhy")}</p>

      {canToggle ? (
        <div className="mf-row">
          <Button onClick={() => onTogglePark(mission)} disabled={pending}>
            {pending
              ? t(parked ? "card.unparking" : "card.parking")
              : t(parked ? "card.unpark" : "card.park")}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
