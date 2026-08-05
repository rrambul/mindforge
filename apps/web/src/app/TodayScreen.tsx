import type { DebriefFocusSessionInput, FrictionType } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDebriefSession,
  useRunningSession,
  useStartSession,
  useStopSession,
} from "../features/focus/api/use-focus.js";
import { Debrief } from "../features/focus/ui/Debrief.js";
import { RunningSession } from "../features/focus/ui/RunningSession.js";
import { StartFocus } from "../features/focus/ui/StartFocus.js";
import {
  frictionBody,
  useFrictionChips,
  useLogFriction,
} from "../features/friction/api/use-friction.js";
import { FrictionChips } from "../features/friction/ui/FrictionChips.js";
import { ApiError, NetworkError, PROBLEM, isProblemOfType } from "../shared/api/problem.js";
import { Callout } from "../shared/ui/Callout.js";

/**
 * Today (§5.3). One job: get you into a focus session in one tap, or tell you why you shouldn't.
 *
 * Composed here, in the app layer, rather than inside a feature — `focus` and `friction` are
 * separate features and §2.2 rule 6 forbids one importing the other, so the route is what joins
 * them. That is also why the friction chips arrive as a `capture` prop rather than being reached
 * for from inside the running-session component.
 *
 * The vertical order is fixed and each block hides entirely when it has nothing to say. No
 * greeting, no date header, no motivational copy: the first pixel is information. `DUE NOW`,
 * `THIS WEEK`, and `ONE THING` are absent rather than empty — reviews arrive in M5 and the
 * weekly figures in M2, and a block manufactured to fill space trains you to stop reading it.
 */
export function TodayScreen() {
  const { t } = useTranslation("focus");
  const { t: common } = useTranslation("common");

  const running = useRunningSession(true);
  const chips = useFrictionChips(true);
  const start = useStartSession();
  const stop = useStopSession();
  const debrief = useDebriefSession();
  const logFriction = useLogFriction();

  /**
   * The session just stopped, awaiting its debrief. Local state rather than derived, because
   * "stopped a moment ago" is a fact about this screen's history and not about the data — a
   * session stopped yesterday must not reopen its debrief when you come back.
   */
  const [awaitingDebrief, setAwaitingDebrief] = useState<string | null>(null);

  const session = running.data?.session ?? null;

  function onStart(intention: string | null): void {
    // The client mints the id so the optimistic row and the persisted one are the same row, and
    // a retry is a replay rather than a second session (§6.1).
    start.mutate({ id: crypto.randomUUID(), ...(intention === null ? {} : { intention }) });
  }

  function onStop(): void {
    if (!session) return;
    const stopped = session.id;
    stop.mutate({ id: stopped }, { onSuccess: () => setAwaitingDebrief(stopped) });
  }

  function onDebrief(answers: DebriefFocusSessionInput): void {
    if (!awaitingDebrief) return;
    debrief.mutate(
      { id: awaitingDebrief, debrief: answers },
      { onSuccess: () => setAwaitingDebrief(null) },
    );
  }

  function onLogFriction(type: FrictionType): void {
    logFriction.mutate(frictionBody(type, session?.id ?? null));
  }

  if (running.isPending) {
    return <p className="mf-muted">{common("state.loading")}</p>;
  }

  return (
    <div className="mf-stack">
      {/* Only failures the server actually *refused*. A capture that merely did not arrive has
          been queued and will land, so a red "didn't reach the server" alert beside a running
          timer would contradict itself — the pending-captures count in the shell is what reports
          that, and it is the honest version because it says "waiting" rather than "failed". */}
      {refused(start.error) ? (
        <Callout
          tone={isProblemOfType(start.error, PROBLEM.focusAlreadyRunning) ? "warning" : "danger"}
          live
        >
          {describe(start.error, common)}
        </Callout>
      ) : null}

      {refused(stop.error) ? (
        <Callout tone="danger" live>
          {describe(stop.error, common)}
        </Callout>
      ) : null}

      {session ? (
        <RunningSession
          session={session}
          onStop={onStop}
          stopping={stop.isPending}
          capture={
            <FrictionChips
              inline={chips.data?.inline ?? []}
              overflow={chips.data?.overflow ?? []}
              onLog={onLogFriction}
            />
          }
        />
      ) : awaitingDebrief ? (
        <>
          {debrief.isError ? (
            <Callout tone="danger" live>
              {describe(debrief.error, common)}
            </Callout>
          ) : null}
          <Debrief
            onSubmit={onDebrief}
            onSkip={() => setAwaitingDebrief(null)}
            pending={debrief.isPending}
          />
        </>
      ) : (
        <section className="mf-stack">
          <h1 className="mf-h1">{t("start.heading")}</h1>
          <StartFocus onStart={onStart} starting={start.isPending} />
        </section>
      )}
    </div>
  );
}

/**
 * A failure the server sent back, as opposed to one that never reached it.
 *
 * The distinction is the same one the mutations branch on: refused means it will never land and
 * has to be shown; unreachable means it is queued and showing it would be wrong.
 */
function refused(error: unknown): boolean {
  return error instanceof ApiError;
}

function describe(error: unknown, common: (key: string) => string): string {
  if (error instanceof NetworkError) return common("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return common("error.unexpectedBody");
}
