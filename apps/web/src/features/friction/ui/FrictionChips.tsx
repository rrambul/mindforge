import { COLD_START_CHIPS, PINNED_FRICTION_TYPE, type FrictionType } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button.js";

interface FrictionChipsProps {
  readonly inline: readonly FrictionType[];
  readonly overflow: readonly FrictionType[];
  readonly onLog: (type: FrictionType) => void;
}

/**
 * The one-tap capture control (§5.3).
 *
 * Four chips inline, the rest behind "More". Eleven chips is not a one-tap UI at 375px, and this
 * is the documented resolution rather than a compromise: one tap in the common case, two in the
 * tail. Intensity is never asked here — the server defaults it to 3, and you can adjust it from
 * the debrief where you have the time.
 *
 * Falls back to the cold-start four while the ranking is still loading, so the bar is never
 * empty mid-session. A control that appears a moment after you reached for it is a control you
 * stop reaching for.
 */
export function FrictionChips({ inline, overflow, onLog }: FrictionChipsProps) {
  const { t } = useTranslation("friction");
  const [showAll, setShowAll] = useState(false);

  const shown = inline.length > 0 ? inline : COLD_START_CHIPS;

  return (
    <div className="mf-chips" data-testid="friction-chips">
      <span className="mf-sr-only" id="friction-chips-label">
        {t("logLabel")}
      </span>

      <div className="mf-chips__row" role="group" aria-labelledby="friction-chips-label">
        {shown.map((type) => (
          <button
            key={type}
            type="button"
            // Pinned permanently, and marked so a reader can tell it apart from the three that
            // rotate with usage.
            className={
              type === PINNED_FRICTION_TYPE
                ? "mf-chip-button mf-chip-button--ember"
                : "mf-chip-button"
            }
            onClick={() => onLog(type)}
          >
            {t(`type.${type}`)}
          </button>
        ))}

        {overflow.length > 0 ? (
          <Button
            variant="quiet"
            onClick={() => setShowAll((open) => !open)}
            aria-expanded={showAll}
          >
            {showAll ? t("less") : t("more")}
          </Button>
        ) : null}
      </div>

      {/* A sheet on mobile, an expanded row on desktop — same registry, different surface
          (§5.1). Rendered inline rather than in a portal so it cannot end up above the
          thumb zone. */}
      {showAll ? (
        <div className="mf-chips__row mf-chips__sheet" role="group" aria-label={t("allTypes")}>
          {overflow.map((type) => (
            <button
              key={type}
              type="button"
              className="mf-chip-button"
              onClick={() => {
                onLog(type);
                // Closes after a tap: the tail is for the one-off, and leaving eleven chips open
                // would push the four you actually use off the screen.
                setShowAll(false);
              }}
            >
              {t(`type.${type}`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
