import { useTranslation } from "react-i18next";

import { Button, Text } from "../../../shared/ui/index.js";
import { useAutoLessonSession } from "../api/use-auto-lesson-session.js";
import { useRunningSession, useStartSession } from "../api/use-focus.js";

/**
 * The timer on the lesson you are reading (FR-F3).
 *
 * **Opening the lesson already started one.** `useAutoLessonSession` times the reader
 * while it is open, so by the time this renders there is usually a session running and
 * this component's job is to say so rather than to offer a button. The button remains for
 * the two states the automatic one does not cover: the cap has been reached, or the start
 * failed.
 *
 * **One tap, and no intention field.** The Today screen asks "what does done look like
 * for this block?" because a block started there could be about anything; here the answer
 * is on screen above the button. Asking again would spend the ≤5s budget re-stating the
 * page you are on.
 *
 * **It sends the lesson and not the mission.** A lesson belongs to exactly one mission, so
 * the API takes the second half from the first — which is what "binding is optional and
 * never asked twice" means when there are two things to bind.
 *
 * This is mounted only for a lesson that has a file behind it (`LessonRoute`), which is
 * what makes enabling the automatic session here unconditional.
 */
export function StartLessonFocus({ lessonId }: { readonly lessonId: string }) {
  const { t } = useTranslation("focus");
  const running = useRunningSession(true);
  const start = useStartSession();

  useAutoLessonSession(lessonId, true);

  const session = running.data?.session ?? null;

  // Named separately because they read differently: one is this lesson being timed for
  // you, the other is a block you started for something else and would have to stop.
  if (session?.lessonId === lessonId) {
    return (
      <Text tone="hint">
        {session.entryMode === "auto" ? t("lesson.autoRunning") : t("lesson.alreadyRunning")}
      </Text>
    );
  }

  if (session !== null) return <Text tone="hint">{t("lesson.alreadyRunning")}</Text>;

  return (
    <Button
      disabled={start.isPending}
      onClick={() => {
        // The id is minted here, like every other capture path (§6.1), so a retry is a
        // replay rather than a second session.
        start.mutate({ id: crypto.randomUUID(), lessonId });
      }}
    >
      {start.isPending ? t("start.starting") : t("lesson.start")}
    </Button>
  );
}
