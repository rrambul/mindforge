import { useTranslation } from "react-i18next";

import { Button, Text } from "../../../shared/ui/index.js";
import { useRunningSession, useStartSession } from "../api/use-focus.js";

/**
 * Start the timer on the lesson you are reading (FR-F3).
 *
 * **One tap, and no intention field.** The Today screen asks "what does done look
 * like for this block?" because a block started there could be about anything;
 * here the answer is on screen above the button. Asking again would spend the ≤5s
 * budget re-stating the page you are on.
 *
 * **It sends the lesson and not the mission.** A lesson belongs to exactly one
 * mission, so the API takes the second half from the first — which is what
 * "binding is optional and never asked twice" means when there are two things to
 * bind.
 *
 * The id is minted here, like every other capture path (§6.1), so a retry is a
 * replay rather than a second session.
 */
export function StartLessonFocus({ lessonId }: { readonly lessonId: string }) {
  const { t } = useTranslation("focus");
  const running = useRunningSession(true);
  const start = useStartSession();

  const active = running.data?.session != null;

  if (active) return <Text tone="hint">{t("lesson.alreadyRunning")}</Text>;

  return (
    <Button
      disabled={start.isPending}
      onClick={() => {
        start.mutate({ id: crypto.randomUUID(), lessonId });
      }}
    >
      {start.isPending ? t("start.starting") : t("lesson.start")}
    </Button>
  );
}
