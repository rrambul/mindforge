import { useTranslation } from "react-i18next";
import { Stack, Text } from "../../../shared/ui/index.js";
import type { Goal } from "../api/use-goals.js";
import "./goal-card.css";

/**
 * A goal's progress, or an honest sentence instead of one (§3.8).
 *
 * Three states, and the distinction between the last two is the whole point:
 *
 * - **A measurable goal** gets a bar and a percentage.
 * - **A goal with no targets** gets a sentence and a nudge. Not 0%, and not 100%.
 * - **A goal whose targets exist but cannot be measured** gets a different sentence, because that is
 *   a different fact — the user has done the work of defining it and the app cannot yet see it.
 *
 * When only some targets are measurable, the percentage is shown *with* how much of the goal it
 * covers. A mean over half the weight presented as the progress is not wrong, it is just not the whole
 * claim it appears to be.
 */
export function GoalProgressBar({ goal }: { readonly goal: Goal }) {
  const { t } = useTranslation("goals");

  if (goal.targetCount === 0) {
    return <Text tone="muted">{t("progress.none")}</Text>;
  }

  if (goal.fraction === null) {
    return (
      <Stack>
        <div className="mf-goal-bar" data-unmeasured="true" />
        <Text tone="muted">{t("progress.unmeasured")}</Text>
      </Stack>
    );
  }

  const percent = Math.round(goal.fraction * 100);
  const partial = goal.measuredWeight < goal.totalWeight;

  return (
    <Stack>
      <div
        className="mf-goal-bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("progress.percent", { percent })}
      >
        <div className="mf-goal-bar__fill" style={{ width: `${percent}%` }} />
      </div>
      <Text tone="muted">
        {t("progress.percent", { percent })}
        {partial
          ? ` — ${t("progress.partial", {
              measured: goal.targets.filter((target) => target.fraction !== null).length,
              total: goal.targetCount,
            })}`
          : ""}
      </Text>
    </Stack>
  );
}
