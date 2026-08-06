import type { DebriefFocusSessionInput, FrictionType } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDebriefSession,
  useRecordSession,
  useRunningSession,
  useStartSession,
  useStopSession,
} from "../features/focus/api/use-focus.js";
import { Debrief } from "../features/focus/ui/Debrief.js";
import { LogPastSession } from "../features/focus/ui/LogPastSession.js";
import { RunningSession } from "../features/focus/ui/RunningSession.js";
import { StartFocus } from "../features/focus/ui/StartFocus.js";
import {
  frictionBody,
  useAttributeFriction,
  useFrictionChips,
  useLogFriction,
  useSessionFriction,
} from "../features/friction/api/use-friction.js";
import { FrictionAttribution } from "../features/friction/ui/FrictionAttribution.js";
import { FrictionChips } from "../features/friction/ui/FrictionChips.js";
import { noteBody, useWriteNote } from "../features/notes/api/use-notes.js";
import { NoteComposer } from "../features/notes/ui/NoteComposer.js";
import { useResources } from "../features/resources/api/use-resources.js";
import { useSkills } from "../features/skills/api/use-skills.js";
import { ApiError, NetworkError, PROBLEM, isProblemOfType } from "../shared/api/problem.js";
import { Button, Callout, Heading, Row, Stack, Text } from "../shared/ui/index.js";
import { FirstRun } from "./FirstRun.js";

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
  const record = useRecordSession();
  const logFriction = useLogFriction();
  const writeNote = useWriteNote();

  /**
   * The session just stopped, awaiting its debrief. Local state rather than derived, because
   * "stopped a moment ago" is a fact about this screen's history and not about the data — a
   * session stopped yesterday must not reopen its debrief when you come back.
   */
  const [awaitingDebrief, setAwaitingDebrief] = useState<string | null>(null);

  // Only fetched once a debrief is open, and only the things attribution can point at. Composed here
  // because §2.2 rule 6 keeps `focus` and `friction` from importing skills and resources themselves.
  const sessionFriction = useSessionFriction(awaitingDebrief);
  const skills = useSkills({});
  const resources = useResources({});
  const attribute = useAttributeFriction();
  const [loggingPast, setLoggingPast] = useState(false);

  const session = running.data?.session ?? null;

  function onStart(intention: string | null): void {
    // The client mints the id so the optimistic row and the persisted one are the same row, and
    // a retry is a replay rather than a second session (§6.1).
    start.mutate({ id: crypto.randomUUID(), ...(intention === null ? {} : { intention }) });
  }

  function onStop(): void {
    if (!session) return;
    const stopped = session.id;

    stop.mutate(
      { id: stopped },
      {
        onSuccess: () => setAwaitingDebrief(stopped),
        // A stop that never reached the server has been *queued*, and the block did end — so the
        // debrief has to be offered anyway. It was only offered on success, which meant every session
        // stopped offline lost its ≤30s debrief (FR-F3) with no other way back to it.
        //
        // That is not only a missing prompt: with `hitIntention` left null, `producedLearning` is
        // false, so every `too_hard` and `missing_prerequisite` event in that block is classified as
        // wasteful friction. The subway sessions the queue exists to protect were the ones skewing the
        // ember/slag split.
        //
        // A refusal is different and still hides the form: a 404 means there is no session to debrief.
        onError: (error) => {
          if (error instanceof NetworkError) setAwaitingDebrief(stopped);
        },
      },
    );
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
    return <Text tone="muted">{common("state.loading")}</Text>;
  }

  return (
    <Stack>
      {/* First. An empty account with the focus form at the top and nothing to focus on is where most
          personal tools lose people (§5.3), and the banner is what stops that being the whole screen.
          It renders nothing at all once there is a mission, so it costs a settled user no pixels. */}
      <FirstRun />

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
            <Stack gap="tight">
              <FrictionChips
                inline={chips.data?.inline ?? []}
                overflow={chips.data?.overflow ?? []}
                onLog={onLogFriction}
              />
              {/* FR-N3: one tap, and the subject comes from here rather than a picker — the note
                  attaches to the session and, through it, to the task and mission. */}
              <NoteComposer
                compact
                pending={writeNote.isPending}
                onWrite={(body) =>
                  writeNote.mutate(
                    noteBody({ body, subjectType: "focus_session", subjectId: session.id }),
                  )
                }
              />
            </Stack>
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
            // §5.3 puts friction detail here, "where you have the time" — the chip tap stays one tap.
            // Below the three questions and never required, so the ≤30s budget is unaffected.
            attribution={
              <FrictionAttribution
                events={sessionFriction.data?.events ?? []}
                skills={(skills.data?.skills ?? []).map((skill) => ({
                  id: skill.id,
                  name: skill.name,
                }))}
                resources={(resources.data?.resources ?? []).map((resource) => ({
                  id: resource.id,
                  name: resource.title,
                }))}
                pending={attribute.isPending}
                error={attribute.error === null ? null : describe(attribute.error, common)}
                onAttribute={(eventId, attribution) =>
                  attribute.mutate({ id: eventId, attribution })
                }
              />
            }
          />
        </>
      ) : (
        <Stack>
          <Heading level={1}>{t("start.heading")}</Heading>
          <StartFocus onStart={onStart} starting={start.isPending} />

          {/* Offered only when nothing is running. The moment you remember a block you forgot is
              when you sit down to an idle Today — and on mobile the running state is the bottom
              bar, which must not grow a second form inside the thumb zone (§5.1). */}
          {loggingPast ? (
            <>
              {refused(record.error) ? (
                <Callout tone="danger" live>
                  {describe(record.error, common)}
                </Callout>
              ) : null}
              <LogPastSession
                onSubmit={(input) =>
                  record.mutate(input, { onSuccess: () => setLoggingPast(false) })
                }
                onCancel={() => setLoggingPast(false)}
                pending={record.isPending}
              />
            </>
          ) : (
            <Row>
              <Button variant="quiet" onClick={() => setLoggingPast(true)}>
                {t("past.open")}
              </Button>
            </Row>
          )}
        </Stack>
      )}
    </Stack>
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
