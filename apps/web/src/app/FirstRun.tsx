import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  clearFirstRun,
  readFirstRun,
  shouldOfferFirstRun,
  writeFirstRun,
  type FirstRunState,
} from "../features/first-run/lib/first-run-state.js";
import { FirstRunBanner } from "../features/first-run/ui/FirstRunBanner.js";
import { FirstRunTour, type FirstRunHandlers } from "../features/first-run/ui/FirstRunTour.js";
import { useStartSession } from "../features/focus/api/use-focus.js";
import { useCreateMission, useMissions } from "../features/missions/api/use-missions.js";
import { ApiError, NetworkError } from "../shared/api/problem.js";

/**
 * Supplies the guided first mission with the writes it needs.
 *
 * Lives in `app/` because it touches missions and focus at once — §2.2 rule 6 puts cross-feature
 * composition here, and the tour is cross-feature by definition: its whole point is that the things
 * it creates are connected to each other.
 *
 * Every step goes through the same hooks the rest of the app uses. There is no "onboarding" endpoint,
 * and that is deliberate — a separate write path would be a second place for the rules to live, and
 * would let the tour create rows the real screens could not.
 */
export function FirstRun() {
  const { t } = useTranslation("common");

  const [state, setState] = useState<FirstRunState>(() => readFirstRun());
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decided from real data rather than a flag, so an emptied account gets the offer again.
  const missions = useMissions();
  const createMission = useCreateMission();
  const startSession = useStartSession();

  function advance(next: Partial<FirstRunState> & { step: FirstRunState["step"] }): void {
    const merged = { ...state, ...next };
    setState(merged);
    writeFirstRun(merged);
    setError(null);
  }

  function dismiss(): void {
    const merged = { ...state, dismissed: true };
    setState(merged);
    writeFirstRun(merged);
    setOpen(false);
  }

  function finish(): void {
    // Cleared rather than marked done: the tour is over, and leaving a record of it in this browser
    // serves nobody.
    clearFirstRun();
    setState({ step: "mission", dismissed: true });
    setOpen(false);
  }

  /** Turns a failure into something readable, and keeps the user on the step they were on. */
  async function attempt<T>(work: () => Promise<T>): Promise<T> {
    setError(null);
    try {
      return await work();
    } catch (cause) {
      setError(describe(cause, t));
      throw cause;
    }
  }

  const handlers: FirstRunHandlers = {
    createMission: (input) =>
      attempt(async () => {
        // No client id: `POST /v1/missions` mints its own, unlike the capture endpoints. Creating a
        // mission is not a capture — it is a considered act at a keyboard, so it is not queued offline
        // and does not need to survive a blind replay.
        const mission = await createMission.mutateAsync({
          topic: input.topic,
          why: input.why,
          successLooksLike: null,
          constraints: null,
          currentLevel: null,
        });
        return mission.id;
      }),

    startFocus: (input) =>
      attempt(async () => {
        await startSession.mutateAsync({
          id: crypto.randomUUID(),
          missionId: input.missionId,
          intention: input.intention,
          // 15 minutes, as §5.3 specifies. Planned rather than enforced — the timer does not stop you.
          plannedMinutes: 15,
        });
      }),
  };

  if (open) {
    return (
      <FirstRunTour
        state={state}
        handlers={handlers}
        error={error}
        onAdvance={advance}
        onSkip={dismiss}
        onFinish={finish}
      />
    );
  }

  // Waits for the count rather than guessing: flashing the banner at someone with twelve missions and
  // then removing it is worse than showing it a moment late.
  if (!missions.isSuccess) return null;
  if (!shouldOfferFirstRun(state, missions.data.missions.length)) return null;

  return <FirstRunBanner state={state} onStart={() => setOpen(true)} onDismiss={dismiss} />;
}

function describe(error: unknown, t: (key: string) => string): string {
  if (error instanceof NetworkError) return t("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return t("error.unexpectedBody");
}
