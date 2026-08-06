import { useTranslation } from "react-i18next";
import { Button, Card, Row, Spread, StatusChip, Text } from "../../../shared/ui/index.js";
import type { Goal, GoalTarget } from "../api/use-goals.js";
import { GoalProgressBar } from "./GoalProgressBar.js";
import { TargetRow } from "./TargetRow.js";
import "./goal-card.css";

interface GoalCardProps {
  readonly goal: Goal;
  readonly onSetManual: (goal: Goal, target: GoalTarget, satisfied: boolean) => void;
  readonly onRemoveTarget: (goal: Goal, target: GoalTarget) => void;
  readonly onStartClose: (goal: Goal) => void;
  readonly onReopen: (goal: Goal) => void;
  readonly onStartAddTarget: (goal: Goal) => void;
  readonly pending: boolean;
  readonly children?: React.ReactNode;
}

/** Dumb by design: props in, markup out. */
export function GoalCard({
  goal,
  onSetManual,
  onRemoveTarget,
  onStartClose,
  onReopen,
  onStartAddTarget,
  pending,
  children,
}: GoalCardProps) {
  const { t } = useTranslation("goals");
  const { t: g } = useTranslation("glossary");

  const closed = goal.status !== "active";

  return (
    <Card as="article" variant={closed ? "muted" : "raised"}>
      <Spread>
        {/* Translated from the stored enum value, never from display text (§5.2). */}
        <StatusChip>{g(`goalStatus.${goal.status}`)}</StatusChip>
        {/* The date is shown exactly as stored. Formatting `2026-09-30` through a Date would move it
            a day for anyone west of UTC — it is a calendar day, not an instant. */}
        {goal.targetDate ? <StatusChip>{goal.targetDate}</StatusChip> : null}
      </Spread>

      <Text>{goal.title}</Text>
      {goal.definitionOfDone ? <Text tone="muted">{goal.definitionOfDone}</Text> : null}

      <GoalProgressBar goal={goal} />

      {/* A prompt, never an automatic close. Closing is a decision, and taking it away would take the
          outcome note with it — the only part worth reading later. */}
      {goal.allTargetsMet && !closed ? (
        <Text>
          {t("progress.allMet")} {t("progress.closePrompt")}
        </Text>
      ) : null}

      {/* Stated plainly with no editorial. A missed goal is data, not a blemish. */}
      {closed && goal.outcomeNote ? <Text tone="muted">{goal.outcomeNote}</Text> : null}

      {goal.targets.length > 0 ? (
        <ul className="mf-target-list" aria-label={t("target.heading")}>
          {goal.targets.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              editable={!closed}
              pending={pending}
              onSetManual={(t2, satisfied) => onSetManual(goal, t2, satisfied)}
              onRemove={(t2) => onRemoveTarget(goal, t2)}
            />
          ))}
        </ul>
      ) : null}

      {children}

      <Row>
        {closed ? (
          <Button onClick={() => onReopen(goal)} disabled={pending}>
            {t("close.reopen")}
          </Button>
        ) : (
          <>
            <Button onClick={() => onStartAddTarget(goal)} disabled={pending}>
              {t("target.add")}
            </Button>
            <Button variant="quiet" onClick={() => onStartClose(goal)} disabled={pending}>
              {t("close.action")}
            </Button>
          </>
        )}
      </Row>
    </Card>
  );
}
