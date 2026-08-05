import { COLD_START_CHIPS, PINNED_FRICTION_TYPE, type FrictionType } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ChoiceGroup, Row, Stack, type Choice } from "../../../shared/ui/index.js";
import "./friction-chips.css";

interface FrictionChipsProps {
  readonly inline: readonly FrictionType[];
  readonly overflow: readonly FrictionType[];
  readonly onLog: (type: FrictionType) => void;
}

/**
 * The one-tap capture control (§5.3).
 *
 * Four chips inline, the rest behind "More" — the documented resolution to eleven types against a
 * one-tap budget: one tap in the common case, two in the tail. Intensity is never asked here.
 *
 * `value` is always null: these chips *fire* rather than select, so nothing stays pressed. That is
 * the one place this differs from the debrief's use of the same control, and it is deliberate — a
 * friction tap is an event, not a setting, and leaving one lit would suggest it could be un-tapped.
 */
export function FrictionChips({ inline, overflow, onLog }: FrictionChipsProps) {
  const { t } = useTranslation("friction");
  const [showAll, setShowAll] = useState(false);

  // Falls back while the ranking loads, so the bar is never empty mid-session. A control that
  // appears a moment after you reached for it is a control you stop reaching for.
  const shown = inline.length > 0 ? inline : COLD_START_CHIPS;

  const toChoice = (type: FrictionType): Choice<FrictionType> => ({
    value: type,
    label: t(`type.${type}`),
    ...(type === PINNED_FRICTION_TYPE ? { accent: "ember" as const } : {}),
  });

  return (
    <Stack gap="tight">
      <div data-testid="friction-chips">
        <Row>
          <ChoiceGroup
            legend={t("logLabel")}
            choices={shown.map(toChoice)}
            value={null}
            onChange={onLog}
          />
          {overflow.length > 0 ? (
            <Button
              variant="quiet"
              onClick={() => setShowAll((open) => !open)}
              aria-expanded={showAll}
            >
              {showAll ? t("less") : t("more")}
            </Button>
          ) : null}
        </Row>

        {/* A sheet on mobile, an expanded row on desktop — same registry, different surface (§5.1).
            Inline rather than in a portal so it cannot end up above the thumb zone. */}
        {showAll ? (
          <div className="mf-friction-sheet">
            <ChoiceGroup
              legend={t("allTypes")}
              choices={overflow.map(toChoice)}
              value={null}
              onChange={(type) => {
                onLog(type);
                // Closed after a tap: the tail is for the one-off, and leaving eleven chips open
                // would push the four you actually use off the screen.
                setShowAll(false);
              }}
            />
          </div>
        ) : null}
      </div>
    </Stack>
  );
}
