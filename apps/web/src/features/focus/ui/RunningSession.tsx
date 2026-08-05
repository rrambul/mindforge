import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Figure, Text } from "../../../shared/ui/index.js";
import type { FocusSession } from "../api/use-focus.js";
import { formatElapsed, useElapsed } from "../model/use-elapsed.js";
import "./running-session.css";

interface RunningSessionProps {
  readonly session: FocusSession;
  readonly onStop: () => void;
  readonly stopping: boolean;
  /** The friction chips, composed in by the route — features do not import each other. */
  readonly capture?: ReactNode;
}

/**
 * The running-session block, which on mobile *is* the persistent bottom bar (§5.1).
 *
 * Stop and the friction chips live together and are reachable one-handed without navigating, because
 * both are things you do mid-session while your attention is elsewhere.
 *
 * Not a `Card`: it becomes fixed furniture at the bottom of the viewport on a narrow screen, which is
 * a layout role rather than a surface, so it owns its own stylesheet.
 */
export function RunningSession({ session, onStop, stopping, capture }: RunningSessionProps) {
  const { t } = useTranslation("focus");
  const { minutes, seconds } = useElapsed(session.startedAt);

  return (
    <section className="mf-running" aria-label={t("running.label")}>
      <div className="mf-running__head">
        <div>
          {/* aria-live off: `polite` on a value that changes every second would talk over
              everything else on the page. */}
          <p className="mf-running__elapsed" aria-live="off">
            <Figure>{formatElapsed(minutes, seconds)}</Figure>
          </p>
          {session.intention ? (
            <Text tone="muted">{session.intention}</Text>
          ) : (
            <Text tone="hint">{t("running.noIntention")}</Text>
          )}
        </div>

        <Button variant="primary" onClick={onStop} disabled={stopping}>
          {stopping ? t("running.stopping") : t("running.stop")}
        </Button>
      </div>

      {capture}
    </section>
  );
}
