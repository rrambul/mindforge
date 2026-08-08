import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/index.js";
import { useDismissNudge, useNudges } from "../api/use-notifications.js";
import { NudgeList } from "./NudgeList.js";
import "./notifications.css";

interface NudgeMarkerProps {
  /** See `NudgeList` — the app layer resolves a subject to a route. */
  readonly hrefFor?: (subjectType: string, subjectId: string) => string | undefined;
  /** The shell's `signedIn`. `/notifications` is a 401 without a session. */
  readonly enabled?: boolean;
}

/**
 * The marker in the top bar, and the list behind it (FR-N1, FR-N3).
 *
 * **Not a modal and not a takeover**, which is §14.1's argument about the changelog applied to the
 * thing it was really about: an app that interrupts your focus session to announce itself has failed
 * its own thesis. So this is a count you can ignore, a panel with no backdrop and no focus trap, and
 * a page behind it that stays scrollable and clickable the whole time.
 *
 * **Nothing at all when there is nothing.** No zero badge, no greyed bell. FR-N4's "quiet by default"
 * is about delivery, and the quietest honest delivery of no news is no element.
 */
export function NudgeMarker({ hrefFor, enabled = true }: NudgeMarkerProps) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const nudges = useNudges(enabled);
  const dismiss = useDismissNudge();

  const items = nudges.data?.notifications ?? [];
  if (items.length === 0) return null;

  return (
    <div
      className="mf-nudges"
      onKeyDown={(event) => {
        // Escape closes it, the way every other dismissible surface behaves. There is no global
        // listener and no outside-click handler: this is a disclosure, and one that stole clicks
        // from the page would be the takeover it is trying not to be.
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <Button
        variant="quiet"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {t("notifications.marker", { count: items.length })}
      </Button>

      {open ? (
        <div
          className="mf-nudges__panel"
          id={panelId}
          role="region"
          aria-label={t("notifications.heading")}
        >
          <NudgeList
            nudges={items}
            onDismiss={(id) => dismiss.mutate({ id })}
            {...(dismiss.isPending && dismiss.variables
              ? { dismissingId: dismiss.variables.id }
              : {})}
            {...(hrefFor === undefined ? {} : { hrefFor })}
          />
        </div>
      ) : null}
    </div>
  );
}
