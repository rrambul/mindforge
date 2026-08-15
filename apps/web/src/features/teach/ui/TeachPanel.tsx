import { useTranslation } from "react-i18next";

import {
  ApiError,
  isProblemOfType,
  PROBLEM,
  type RequestError,
} from "../../../shared/api/problem.js";
import { Button, Callout, Label, Stack, Text } from "../../../shared/ui/index.js";
import {
  isRunning,
  latestRun,
  useMissionRuns,
  useStartTeachRun,
  type AgentRunView,
  type RunWarningView,
} from "../api/use-teach.js";

/**
 * "Teach me the next thing", and what happened last time (FR-T3).
 *
 * Three things it says that a simpler version would not, all for the same reason
 * — a run costs money and takes minutes, so the learner has to be able to tell
 * what state theirs is in:
 *
 * 1. **A conflicted run is a success, and reads like one.** Both versions were
 *    kept (§7.4), so the message is "nothing was overwritten" rather than a
 *    warning tone. Calling it a failure would push people toward re-running,
 *    which makes more conflicts.
 * 2. **Warnings are shown, not swallowed.** §7.4's degradation rule is "stored,
 *    partially indexed", and that is only useful if the partiality reaches
 *    somebody. Each renders from its own stable key, so it translates.
 * 3. **A run in progress is not a disabled button with no explanation.** It says
 *    what is happening and that you can leave the page, because the honest answer
 *    to a five-minute wait is not a spinner.
 */

interface TeachPanelProps {
  readonly missionId: string;
  /**
   * What the button says when nothing is running.
   *
   * The endpoint decides *which* agent runs — from whether the mission has modules
   * yet (FR-K1), because that is not a choice a browser should make. But the
   * learner is owed the truth about what they are about to start, and "teach me
   * the next thing" on a mission with no curriculum would be describing the wrong
   * one. The screen that knows which state it is in passes the wording.
   */
  readonly label?: string;
}

export function TeachPanel({ missionId, label }: TeachPanelProps) {
  const { t } = useTranslation("teach");
  const runs = useMissionRuns(missionId);
  const start = useStartTeachRun(missionId);

  const run = latestRun(runs.data);
  const active = run !== null && isRunning(run.status);

  return (
    <Stack gap="tight">
      <Button
        // Disabled while a run is live rather than hidden: the button is where
        // the learner looks, and removing it makes the page feel broken.
        disabled={active || start.isPending}
        onClick={() => {
          start.mutate();
        }}
      >
        {active
          ? t("action.running")
          : start.isPending
            ? t("action.starting")
            : (label ?? t("action.start"))}
      </Button>

      {start.isError ? <StartError error={start.error} /> : null}

      {run !== null && <RunStatus run={run} />}
    </Stack>
  );
}

/**
 * Why the button did nothing.
 *
 * The mutation's error was not rendered at all until the daily budget existed: the
 * keys `error.run_already_active` and `error.generic` had been in both locale files
 * since M3 with nothing reading them, so a refused press looked exactly like a press
 * that had not registered. A learner's next move is to press again, which is the one
 * response that cannot help.
 *
 * Branching on the slug rather than only rendering `detail`, for the two cases where
 * there is something to *do*: a run already in progress is answered by the status
 * below rather than by an error, and a spent budget is answered by saying when it
 * resets.
 */
function StartError({ error }: { readonly error: RequestError }) {
  const { t } = useTranslation("teach");

  if (isProblemOfType(error, PROBLEM.runAlreadyActive)) {
    return (
      <Callout tone="neutral" live>
        <Text>{t("error.run_already_active")}</Text>
      </Callout>
    );
  }

  if (isProblemOfType(error, PROBLEM.teachDailyBudgetExhausted)) {
    return (
      <Callout tone="neutral" live>
        {/* `neutral`, not `danger`: nothing is broken and the learner did nothing
            wrong. The API's own `detail` names the figure, and it arrives already
            translated (§6.1) — reproducing it here would be the same sentence in a
            second place, in one fewer language. */}
        <Text>
          {error instanceof ApiError ? error.problem?.detail : t("error.budget_exhausted")}
        </Text>
      </Callout>
    );
  }

  return (
    <Callout tone="danger" live>
      <Text>
        {error instanceof ApiError
          ? (error.problem?.detail ?? t("error.generic"))
          : t("error.generic")}
      </Text>
    </Callout>
  );
}

function RunStatus({ run }: { readonly run: AgentRunView }) {
  const { t } = useTranslation("teach");

  const lessons = run.result?.changes?.["added"]?.length ?? 0;
  const conflicts = run.result?.conflicts ?? [];
  const warnings = run.result?.warnings ?? [];

  return (
    <Stack gap="tight">
      <Text tone="muted">
        {run.status === "succeeded_with_conflicts"
          ? t("status.succeeded_with_conflicts", { count: conflicts.length })
          : t(`status.${run.status}`, { count: lessons })}
      </Text>

      {conflicts.length > 0 && (
        <Callout tone="neutral">
          <Stack gap="tight">
            <Label>{t("conflict.heading")}</Label>
            <Text>{t("conflict.body")}</Text>
            {conflicts.map((conflict) => (
              <Text key={conflict.path} tone="hint">
                {t("conflict.path", { path: conflict.path })}
              </Text>
            ))}
          </Stack>
        </Callout>
      )}

      {warnings.length > 0 && (
        <Callout tone="warning">
          <Stack gap="tight">
            <Label>{t("warning.heading", { count: warnings.length })}</Label>
            <Text>{t("warning.body")}</Text>
            {warnings.map((warning, index) => (
              <Text key={`${warning.code}-${String(index)}`} tone="hint">
                {describeWarning(warning, t)}
              </Text>
            ))}
          </Stack>
        </Callout>
      )}
    </Stack>
  );
}

/**
 * A warning's own key, with its ICU arguments.
 *
 * Falls back to the code itself rather than to a generic sentence: a code nobody
 * has written a message for is a gap in the locale files, and showing it makes
 * that visible instead of hiding it behind "something wasn't indexed". The
 * parsers can grow a warning kind faster than two locales can.
 */
function describeWarning(
  warning: RunWarningView,
  t: ReturnType<typeof useTranslation<"teach">>["t"],
): string {
  const key = `warning.${warning.code}`;
  const rendered = t(key, { ...warning.args, defaultValue: "" });
  // i18next returns the key itself for a missing entry under some configurations
  // and the default under others, so both are treated as "no message yet".
  return rendered === "" || rendered === key ? warning.code : rendered;
}
