import { useTranslation } from "react-i18next";
import { Button, ButtonLink, Text } from "../../../shared/ui/index.js";
import type { Nudge } from "../api/use-notifications.js";
import { nudgeMessage } from "../model/message.js";
import "./notifications.css";

interface NudgeListProps {
  readonly nudges: readonly Nudge[];
  readonly onDismiss: (id: string) => void;
  /** The one being dismissed, so only its button goes quiet rather than the whole list. */
  readonly dismissingId?: string | undefined;
  /**
   * Where a nudge's subject lives, supplied by whoever composes this.
   *
   * FR-N1 wants tapping one to open the thing it is about, and this feature cannot know the route
   * table (§2.2 rule 6). Returning undefined means "no page for that yet", and the row then reads as
   * a statement rather than offering a link that goes nowhere.
   */
  readonly hrefFor?: (subjectType: string, subjectId: string) => string | undefined;
}

/**
 * The nudges, as lines (FR-N1, FR-N3).
 *
 * Every one is translated from its `kind` with its payload as the ICU arguments — the row never
 * carries a sentence, so the same nudge reads in either language. `nudgeMessage` decides which
 * message the payload can actually satisfy.
 *
 * Dumb on purpose: the bar's marker and the settings screen render the same list from the same
 * cache, and a component that fetched would make those two different lists.
 */
export function NudgeList({ nudges, onDismiss, dismissingId, hrefFor }: NudgeListProps) {
  const { t } = useTranslation("settings");

  if (nudges.length === 0) {
    // "Nothing to tell you" is a real answer and worth saying, unlike a badge showing zero.
    return <Text tone="muted">{t("notifications.empty")}</Text>;
  }

  return (
    <ul className="mf-nudge-list">
      {nudges.map((nudge) => {
        const message = nudgeMessage(nudge);
        const href =
          nudge.subjectType !== null && nudge.subjectId !== null
            ? hrefFor?.(nudge.subjectType, nudge.subjectId)
            : undefined;

        return (
          <li className="mf-nudge" key={nudge.id}>
            <span className="mf-nudge__text">
              {t(`notifications.kind.${message.key}`, message.args)}
            </span>
            {href === undefined ? null : (
              <ButtonLink variant="quiet" href={href}>
                {t("notifications.open")}
              </ButtonLink>
            )}
            <Button
              variant="quiet"
              onClick={() => {
                onDismiss(nudge.id);
              }}
              disabled={dismissingId === nudge.id}
            >
              {t("notifications.dismiss")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
