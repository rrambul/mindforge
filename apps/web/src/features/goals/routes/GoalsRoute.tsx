import { GOAL_STATUSES, type GoalStatus } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import {
  Button,
  Callout,
  Field,
  Heading,
  Row,
  Select,
  Spread,
  Stack,
  Text,
  TextareaField,
} from "../../../shared/ui/index.js";
import {
  useAddTarget,
  useCloseGoal,
  useCreateGoal,
  useGoals,
  useRemoveTarget,
  useReopenGoal,
  useSetManualTarget,
  type Goal,
  type GoalTarget,
} from "../api/use-goals.js";
import { AddTargetForm } from "../ui/AddTargetForm.js";
import { CloseGoalForm } from "../ui/CloseGoalForm.js";
import { GoalCard } from "../ui/GoalCard.js";

type Filter = "all" | GoalStatus;

export interface GoalsRouteProps {
  /**
   * What a target can point at, supplied rather than fetched.
   *
   * A target *points at* a resource or a mission, so the picker needs their names — the alternative is
   * a uuid text box. But reading them here would mean this feature importing two others, which §2.2
   * rule 6 forbids and the boundary rule catches. Cross-feature composition belongs to `app/`, so
   * `GoalsScreen` gathers them and passes them down. That is the same shape `TodayScreen` already has.
   */
  readonly resources: readonly { id: string; title: string }[];
  readonly missions: readonly { id: string; topic: string }[];
}

/** The goals screen (FR-M3). */
export function GoalsRoute({ resources, missions }: GoalsRouteProps) {
  const { t } = useTranslation("goals");
  const { t: g } = useTranslation("glossary");
  const { t: common } = useTranslation("common");

  const [filter, setFilter] = useState<Filter>("all");
  const [writing, setWriting] = useState(false);
  const [title, setTitle] = useState("");
  const [definitionOfDone, setDefinitionOfDone] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [closingId, setClosingId] = useState<string | null>(null);
  const [addingTargetTo, setAddingTargetTo] = useState<string | null>(null);

  const goals = useGoals(filter === "all" ? {} : { status: filter });

  const create = useCreateGoal();
  const close = useCloseGoal();
  const reopen = useReopenGoal();
  const addTarget = useAddTarget();
  const removeTarget = useRemoveTarget();
  const setManual = useSetManualTarget();

  const pendingId =
    close.variables?.id ??
    reopen.variables?.id ??
    addTarget.variables?.goalId ??
    removeTarget.variables?.goalId ??
    setManual.variables?.goalId;

  const failure = [
    create.error,
    close.error,
    reopen.error,
    addTarget.error,
    removeTarget.error,
    setManual.error,
  ].find((error) => error !== null);

  const trimmedTitle = title.trim();

  function submitGoal(): void {
    if (trimmedTitle === "") return;
    create.mutate(
      {
        id: crypto.randomUUID(),
        title: trimmedTitle,
        ...(definitionOfDone.trim() === "" ? {} : { definitionOfDone: definitionOfDone.trim() }),
        ...(targetDate === "" ? {} : { targetDate }),
        targets: [],
      },
      {
        // Cleared only on success, so a rejected goal leaves the typing in place to fix.
        onSuccess: () => {
          setTitle("");
          setDefinitionOfDone("");
          setTargetDate("");
          setWriting(false);
        },
      },
    );
  }

  return (
    <Stack>
      <Spread>
        <Heading level={1}>{t("heading")}</Heading>
      </Spread>

      <Row>
        <Button variant="primary" onClick={() => setWriting(!writing)}>
          {writing ? t("create.close") : t("create.toggle")}
        </Button>
      </Row>

      {writing ? (
        <Stack>
          <Field
            label={t("create.title")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextareaField
            label={t("create.definitionOfDone")}
            rows={2}
            value={definitionOfDone}
            onChange={(event) => setDefinitionOfDone(event.target.value)}
          />
          {/* `type="date"` gives a `YYYY-MM-DD` string, which is exactly what the API wants — no Date
              anywhere, so the day cannot shift. */}
          <Field
            label={t("create.targetDate")}
            type="date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
          />
          <Row>
            <Button
              variant="primary"
              onClick={submitGoal}
              disabled={trimmedTitle === "" || create.isPending}
            >
              {t("create.action")}
            </Button>
          </Row>
        </Stack>
      ) : null}

      <Select
        label={t("filter.label")}
        value={filter}
        onChange={(event) => setFilter(event.target.value as Filter)}
        options={[
          { value: "all", label: t("filter.all") },
          // From the glossary, so the filter and the chips cannot say different words for one status.
          ...GOAL_STATUSES.map((status) => ({
            value: status,
            label: g(`goalStatus.${status}`),
          })),
        ]}
      />

      {failure ? (
        <Callout tone="danger" live>
          {describe(failure, common)}
        </Callout>
      ) : null}

      {goals.isPending ? <Text tone="muted">{common("state.loading")}</Text> : null}

      {goals.isError ? (
        <Callout tone="danger" live>
          <Text>{describe(goals.error, common)}</Text>
          <Row>
            <Button onClick={() => void goals.refetch()}>{common("action.retry")}</Button>
          </Row>
        </Callout>
      ) : null}

      {goals.isSuccess && goals.data.goals.length === 0 ? (
        // Two different facts: no goals at all is an invitation, an empty filter is about the filter.
        <Text tone="muted">{filter === "all" ? t("empty.all") : t("empty.filtered")}</Text>
      ) : null}

      {goals.isSuccess ? (
        <Stack>
          {goals.data.goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              pending={pendingId === goal.id}
              onStartClose={(target: Goal) => setClosingId(target.id)}
              onReopen={(target: Goal) => reopen.mutate({ id: target.id })}
              onStartAddTarget={(target: Goal) => setAddingTargetTo(target.id)}
              onSetManual={(target: Goal, t2: GoalTarget, satisfied: boolean) =>
                setManual.mutate({ goalId: target.id, targetId: t2.id, satisfied })
              }
              onRemoveTarget={(target: Goal, t2: GoalTarget) =>
                removeTarget.mutate({ goalId: target.id, targetId: t2.id })
              }
            >
              {closingId === goal.id ? (
                <CloseGoalForm
                  pending={close.isPending}
                  onCancel={() => setClosingId(null)}
                  onClose={(body) =>
                    close.mutate({ id: goal.id, body }, { onSuccess: () => setClosingId(null) })
                  }
                />
              ) : null}

              {addingTargetTo === goal.id ? (
                <AddTargetForm
                  pending={addTarget.isPending}
                  resources={resources}
                  missions={missions}
                  onCancel={() => setAddingTargetTo(null)}
                  onAdd={(target) =>
                    addTarget.mutate(
                      { goalId: goal.id, target },
                      { onSuccess: () => setAddingTargetTo(null) },
                    )
                  }
                />
              ) : null}
            </GoalCard>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function describe(error: unknown, common: (key: string) => string): string {
  if (error instanceof NetworkError) return common("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return common("error.unexpectedBody");
}
