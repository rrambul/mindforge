import { useTranslation } from "react-i18next";
import { Callout, Select, Stack, Text } from "../../../shared/ui/index.js";
import type { FrictionEventRow } from "../api/use-friction.js";

export interface AttributionTarget {
  readonly id: string;
  readonly name: string;
}

interface FrictionAttributionProps {
  readonly events: readonly FrictionEventRow[];
  /** Names for the pickers, supplied by the app layer — this feature may not import those (§2.2 rule 6). */
  readonly skills: readonly AttributionTarget[];
  readonly resources: readonly AttributionTarget[];
  readonly onAttribute: (
    eventId: string,
    attribution: { skillId?: string | null; resourceId?: string | null },
  ) => void;
  readonly pending: boolean;
  /** Already translated. */
  readonly error?: string | null;
}

/**
 * What each of this session's friction moments was about (§5.3).
 *
 * `friction_events.skill_id` and `resource_id` have existed since M0 with nothing writing them, so
 * every event was typed but unattributed — which makes "your top friction source is tooling" the most
 * specific thing M2's review screen could say. This is what turns it into "tooling, on the async book".
 *
 * **Here rather than on the chip.** The chip is a one-tap capture and asking "which skill?" mid-annoyance
 * would break the budget the whole feature is built around; §5.3 puts the detail in the debrief, "where
 * you have the time". Nothing here is required, and Submit does not wait for it.
 *
 * Renders nothing when the session had no friction. An empty "what was this about?" block on a clean
 * session would be a question about something that did not happen.
 */
export function FrictionAttribution({
  events,
  skills,
  resources,
  onAttribute,
  pending,
  error = null,
}: FrictionAttributionProps) {
  const { t } = useTranslation("friction");

  if (events.length === 0) return null;

  return (
    <Stack>
      <Text tone="muted">{t("attribution.heading")}</Text>

      {error === null ? null : (
        <Callout tone="danger" live>
          {error}
        </Callout>
      )}

      {events.map((event) => (
        <Stack key={event.id}>
          <Text>{t(`type.${event.type}`)}</Text>

          {/* Two pickers rather than one, because an event can be about both — the async book *and*
              lifetimes. "None" is a real answer and the default, so a moment you cannot place stays
              unplaced rather than being forced onto the nearest thing. */}
          <Select
            label={t("attribution.skill")}
            value={event.skillId ?? ""}
            disabled={pending || skills.length === 0}
            onChange={(change) =>
              onAttribute(event.id, {
                skillId: change.target.value === "" ? null : change.target.value,
              })
            }
            options={[
              { value: "", label: t("attribution.none") },
              ...skills.map((skill) => ({ value: skill.id, label: skill.name })),
            ]}
          />

          <Select
            label={t("attribution.resource")}
            value={event.resourceId ?? ""}
            disabled={pending || resources.length === 0}
            onChange={(change) =>
              onAttribute(event.id, {
                resourceId: change.target.value === "" ? null : change.target.value,
              })
            }
            options={[
              { value: "", label: t("attribution.none") },
              ...resources.map((resource) => ({ value: resource.id, label: resource.name })),
            ]}
          />
        </Stack>
      ))}
    </Stack>
  );
}
