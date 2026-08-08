import { useTranslation } from "react-i18next";
import { Figure, Stack, Text } from "../../../shared/ui/index.js";
import type { FrictionSourcesView } from "../api/use-week-friction.js";
import "./planning.css";

/** Four types and three missions. A ranked list you scroll is a ranked list you stop reading. */
const TOP_TYPES = 4;
const TOP_MISSIONS = 3;

/**
 * Where the week's friction came from (FR-I6b) — half of what makes a review actionable.
 *
 * Every number here is the server's: `GET /insights/friction` folds the cross-tab, orders types by
 * count with the *taxonomy's* own order as the tiebreak rather than alphabetically, and rounds mean
 * intensity to one decimal because two would imply a precision a 1–5 tap does not have. None of that
 * is redone here, and it must not be — a review screen and a rollup disagreeing about your biggest
 * friction source is the failure non-negotiable 3 exists to prevent.
 *
 * Returns `null` when there is nothing to report. A friction list showing "0 interruptions" is a
 * claim; an absent block is the truth.
 */
export function FrictionSources({ sources }: { readonly sources: FrictionSourcesView }) {
  const { t } = useTranslation("planning");
  const { t: friction } = useTranslation("friction");

  if (sources.eventCount === 0) return null;

  return (
    <Stack gap="tight">
      <ul className="mf-friction-rows">
        {sources.byType.slice(0, TOP_TYPES).map((entry) => (
          <li key={entry.type} className="mf-friction-row">
            <span>{friction(`type.${entry.type}`)}</span>
            <span>
              <Figure>{t("friction.count", { count: entry.count })}</Figure>{" "}
              <Text as="span" tone="hint">
                {t("friction.intensity", { intensity: entry.meanIntensity })}
              </Text>
            </span>
          </li>
        ))}
      </ul>

      {/* "Tooling, on Rust" is the sentence the endpoint carries the mission topic for. Omitted
          entirely when no friction had a mission behind it, rather than shown as an empty heading. */}
      {sources.byMission.length === 0 ? null : (
        <Stack gap="tight">
          <Text tone="hint">{t("friction.byMission")}</Text>
          <ul className="mf-friction-rows">
            {sources.byMission.slice(0, TOP_MISSIONS).map((entry) => (
              <li key={entry.missionId} className="mf-friction-row">
                <span>{entry.topic}</span>
                <Figure>{t("friction.count", { count: entry.count })}</Figure>
              </li>
            ))}
          </ul>
        </Stack>
      )}

      {/* Two facts wearing one word, and the distinction is the actionable one: taps logged outside
          any session mean the capture bar is reaching you between blocks, while taps inside sessions
          with no mission mean the picker is being skipped. */}
      {sources.unattributed.total === 0 ? null : (
        <Text tone="muted">
          {t("friction.unattributed", {
            total: sources.unattributed.total,
            standalone: sources.unattributed.standalone,
            sessions: sources.unattributed.sessionWithoutMission,
          })}
        </Text>
      )}
    </Stack>
  );
}
