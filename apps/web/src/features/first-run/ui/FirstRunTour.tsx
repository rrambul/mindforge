import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Callout,
  Card,
  Field,
  Heading,
  Row,
  Stack,
  Text,
  TextareaField,
} from "../../../shared/ui/index.js";
import type { FirstRunState, FirstRunStep } from "../lib/first-run-state.js";

export interface FirstRunHandlers {
  /** Each returns the id of what it created, so the next step can hang off it. */
  readonly createMission: (input: { topic: string; why: string | null }) => Promise<string>;
  readonly createGoal: (input: {
    missionId: string;
    title: string;
    hours: number;
  }) => Promise<string>;
  readonly createResource: (input: {
    url: string | null;
    title: string | null;
    missionId: string;
  }) => Promise<string>;
  readonly startFocus: (input: {
    missionId: string;
    resourceId: string | null;
    intention: string;
  }) => Promise<void>;
}

interface FirstRunTourProps {
  readonly state: FirstRunState;
  readonly handlers: FirstRunHandlers;
  readonly onAdvance: (next: Partial<FirstRunState> & { step: FirstRunStep }) => void;
  readonly onSkip: () => void;
  readonly onFinish: () => void;
  /** Already translated. Shown when a step's write is refused. */
  readonly error: string | null;
}

/**
 * The guided first mission (§5.3) — four steps that produce a real mission, goal, resource, and focus
 * session.
 *
 * Not a tutorial and not demo data: every step writes through the same endpoints the rest of the app
 * uses, so what you are left with is yours to keep, edit, or delete. That is the whole design — a tour
 * that produces rows you then have to clean up teaches that the app's data is disposable.
 *
 * Each step says **why it is being asked**, because the answers are load-bearing later and a form that
 * does not explain itself gets filled in with whatever is fastest. The "why" on step 1 is the clearest
 * case: it is the field the teach agent grounds everything on.
 *
 * Skippable at every step, and the skip is a plain button rather than a small "x" — this is setup, not
 * a paywall.
 */
export function FirstRunTour({
  state,
  handlers,
  onAdvance,
  onSkip,
  onFinish,
  error,
}: FirstRunTourProps) {
  const { t } = useTranslation("firstRun");

  const [topic, setTopic] = useState("");
  const [why, setWhy] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [hours, setHours] = useState("10");
  const [url, setUrl] = useState("");
  const [resourceName, setResourceName] = useState("");
  const [manual, setManual] = useState(false);
  const [intention, setIntention] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * Wraps a step's write so a failure leaves the user on the step with their typing intact.
   *
   * The rejection is swallowed, and that is deliberate rather than lazy: the handler has already put
   * the message on screen, and it rethrows only so `onAdvance` below is skipped. Letting it escape past
   * here makes it an unhandled rejection — a console error in the browser, and a reported crash in
   * anything watching for them, over a validation failure the user can see and fix.
   */
  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await work();
    } catch {
      // Already reported. See above.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Stack>
        <Heading level={2}>{t("heading")}</Heading>
        {state.step === "done" ? null : (
          <Text tone="muted">{t("progress", { step: stepOf(state.step) })}</Text>
        )}

        {error === null ? null : (
          <Callout tone="danger" live>
            {error}
          </Callout>
        )}

        {state.step === "mission" ? (
          <>
            <Text>{t("step.mission.title")}</Text>
            {/* The why is not decoration — every later feature reads it. Said out loud, because a form
                that does not explain itself gets filled in with whatever is fastest. */}
            <Text tone="muted">{t("step.mission.why")}</Text>
            <Field
              label={t("step.mission.topic")}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            />
            <TextareaField
              label={t("step.mission.reason")}
              rows={2}
              value={why}
              onChange={(event) => setWhy(event.target.value)}
            />
            <Row>
              <Button
                variant="primary"
                disabled={topic.trim() === "" || busy}
                onClick={() =>
                  void run(async () => {
                    const missionId = await handlers.createMission({
                      topic: topic.trim(),
                      why: why.trim() === "" ? null : why.trim(),
                    });
                    onAdvance({ step: "goal", missionId });
                  })
                }
              >
                {t("next")}
              </Button>
              <Button variant="quiet" onClick={onSkip}>
                {t("skip")}
              </Button>
            </Row>
          </>
        ) : null}

        {state.step === "goal" ? (
          <>
            <Text>{t("step.goal.title")}</Text>
            {/* Teaches the thing that makes goals here different: they are measured, not declared. */}
            <Text tone="muted">{t("step.goal.why")}</Text>
            <Field
              label={t("step.goal.goalTitle")}
              value={goalTitle}
              onChange={(event) => setGoalTitle(event.target.value)}
            />
            {/* Focus hours, because it is the one target kind that measures itself from the very next
                step — a resource target would sit unmeasurable until something was read, and a skill
                target cannot be measured at all until M2. */}
            <Field
              label={t("step.goal.hours")}
              type="number"
              inputMode="numeric"
              min={1}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
            <Row>
              <Button
                variant="primary"
                disabled={goalTitle.trim() === "" || !isPositive(hours) || busy}
                onClick={() =>
                  void run(async () => {
                    const goalId = await handlers.createGoal({
                      missionId: state.missionId!,
                      title: goalTitle.trim(),
                      hours: Number.parseInt(hours, 10),
                    });
                    onAdvance({ step: "resource", goalId });
                  })
                }
              >
                {t("next")}
              </Button>
              <Button variant="quiet" onClick={onSkip}>
                {t("skip")}
              </Button>
            </Row>
          </>
        ) : null}

        {state.step === "resource" ? (
          <>
            <Text>{t("step.resource.title")}</Text>
            <Text tone="muted">{t("step.resource.why")}</Text>

            {manual ? (
              <Field
                label={t("step.resource.name")}
                value={resourceName}
                onChange={(event) => setResourceName(event.target.value)}
              />
            ) : (
              <Field
                label={t("step.resource.url")}
                type="url"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            )}

            <Row>
              <Button
                variant="primary"
                disabled={(manual ? resourceName.trim() === "" : url.trim() === "") || busy}
                onClick={() =>
                  void run(async () => {
                    const resourceId = await handlers.createResource({
                      url: manual ? null : url.trim(),
                      title: manual ? resourceName.trim() : null,
                      missionId: state.missionId!,
                    });
                    onAdvance({ step: "focus", resourceId });
                  })
                }
              >
                {t("next")}
              </Button>
              {/* Offered rather than assumed: "usually a paste of one URL" is not always, and a book has
                  no link to paste. */}
              <Button variant="quiet" onClick={() => setManual(!manual)}>
                {t("step.resource.manual")}
              </Button>
              <Button variant="quiet" onClick={onSkip}>
                {t("skip")}
              </Button>
            </Row>
          </>
        ) : null}

        {state.step === "focus" ? (
          <>
            <Text>{t("step.focus.title")}</Text>
            {/* The point of ending here: the habit is the product, and everything above was setup. */}
            <Text tone="muted">{t("step.focus.why")}</Text>
            <Field
              label={t("step.focus.intention")}
              value={intention}
              onChange={(event) => setIntention(event.target.value)}
            />
            <Row>
              <Button
                variant="primary"
                disabled={intention.trim() === "" || busy}
                onClick={() =>
                  void run(async () => {
                    await handlers.startFocus({
                      missionId: state.missionId!,
                      resourceId: state.resourceId ?? null,
                      intention: intention.trim(),
                    });
                    onAdvance({ step: "done" });
                  })
                }
              >
                {t("step.focus.start")}
              </Button>
              <Button variant="quiet" onClick={onSkip}>
                {t("skip")}
              </Button>
            </Row>
          </>
        ) : null}

        {state.step === "done" ? (
          <>
            <Text>{t("done.title")}</Text>
            {/* Says plainly that none of it was demo data. That is the claim the whole design rests on,
                and it is worth stating rather than leaving to be discovered. */}
            <Text tone="muted">{t("done.body")}</Text>
            <Row>
              <Button variant="primary" onClick={onFinish}>
                {t("done.close")}
              </Button>
            </Row>
          </>
        ) : null}
      </Stack>
    </Card>
  );
}

function stepOf(step: FirstRunStep): number {
  return ["mission", "goal", "resource", "focus"].indexOf(step) + 1;
}

function isPositive(value: string): boolean {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0;
}
