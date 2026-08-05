import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button.js";
import type { FocusSession } from "../api/use-focus.js";
import { formatElapsed, useElapsed } from "../model/use-elapsed.js";

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
 * Stop and the friction chips live together and are reachable one-handed without navigating,
 * because both are things you do mid-session while your attention is elsewhere. The elapsed
 * figure is mono and tabular so the digits do not jitter as they tick.
 */
export function RunningSession({ session, onStop, stopping, capture }: RunningSessionProps) {
  const { t } = useTranslation("focus");
  const { minutes, seconds } = useElapsed(session.startedAt);

  return (
    <section className="mf-running" aria-label={t("running.label")}>
      <div className="mf-running__head">
        <div>
          {/* aria-live so the elapsed time is announced on request rather than every second —
              `polite` on a value that changes each tick would talk over everything else. */}
          <p className="mf-figure mf-running__elapsed" aria-live="off">
            {formatElapsed(minutes, seconds)}
          </p>
          <p className={session.intention ? "mf-running__intention" : "mf-hint"}>
            {session.intention ?? t("running.noIntention")}
          </p>
        </div>

        <Button variant="primary" onClick={onStop} disabled={stopping}>
          {stopping ? t("running.stopping") : t("running.stop")}
        </Button>
      </div>

      {capture}
    </section>
  );
}
