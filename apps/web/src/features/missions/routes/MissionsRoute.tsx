import { MISSION_WIP_LIMIT, type CreateMissionInput } from "@mindforge/core";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, NetworkError, PROBLEM, isProblemOfType } from "../../../shared/api/problem.js";
import {
  Button,
  Callout,
  Figure,
  Heading,
  Label,
  Row,
  Spread,
  Stack,
  Text,
} from "../../../shared/ui/index.js";
import {
  useCreateMission,
  useMissions,
  useSetMissionParked,
  type Mission,
} from "../api/use-missions.js";
import { fieldErrorsFrom } from "../model/field-errors.js";
import { MissionCard } from "../ui/MissionCard.js";
import { NewMissionForm } from "../ui/NewMissionForm.js";

/**
 * Routes are smart, components are dumb (§2.2 rule 5): this one fetches, composes, and
 * owns the one piece of local state that is genuinely local — whether the create form
 * is open.
 */
export interface MissionsRouteProps {
  /**
   * Builds the note composer for one card, supplied by the app layer.
   *
   * A render prop because the composer needs the notes feature and this one may not import it (§2.2
   * rule 6). Optional, so the route renders without it.
   */
  readonly renderNote?: (subjectId: string) => ReactNode;
  /**
   * "Teach me the next thing" for this mission (FR-T3).
   *
   * A second render prop for the same reason as the first: the panel needs
   * `features/teach`, and a feature may not import another (§2.2 rule 6). The
   * screen in `app/` composes both.
   */
  readonly renderTeach?: (missionId: string) => ReactNode;
  /**
   * The link to a mission's curriculum (FR-K5).
   *
   * A render prop rather than a `<Link>` here, because the route it points at is
   * the app's route table — and because a router link inside this route would put
   * a `RouterProvider` in the way of every test that renders it.
   */
  readonly renderCurriculumLink?: (missionId: string) => ReactNode;
}

export function MissionsRoute({
  renderNote,
  renderTeach,
  renderCurriculumLink,
}: MissionsRouteProps) {
  const { t } = useTranslation("missions");
  const { t: common } = useTranslation("common");
  const [composing, setComposing] = useState(false);

  const missions = useMissions();
  const create = useCreateMission();
  const setParked = useSetMissionParked();

  if (missions.isPending) {
    return <Text tone="muted">{common("state.loading")}</Text>;
  }

  if (missions.isError) {
    return (
      <Callout tone="danger" live>
        <Text>{describe(missions.error, common)}</Text>
        <Row>
          <Button onClick={() => void missions.refetch()}>{common("action.retry")}</Button>
        </Row>
      </Callout>
    );
  }

  const all = missions.data.missions;
  const activeCount = all.filter((mission) => mission.status === "active").length;
  const atLimit = activeCount >= MISSION_WIP_LIMIT;

  function submit(input: CreateMissionInput): void {
    create.mutate(input, { onSuccess: () => setComposing(false) });
  }

  return (
    <Stack>
      <Spread>
        <Heading level={1}>{t("heading")}</Heading>
        {/* The WIP count is stated always, not only when it is reached. The limit is a
            product rule you are supposed to be aware of, and discovering it as a 409
            is the worse way to learn it. */}
        <Label>
          <Figure>{t("wip.used", { used: activeCount, limit: MISSION_WIP_LIMIT })}</Figure>
        </Label>
      </Spread>

      {all.length === 0 ? (
        <Stack>
          {/* Names one action and links to it — never an illustration and a shrug (§5.3). */}
          <Text tone="muted">{t("empty.body")}</Text>
          {!composing ? (
            <Row>
              <Button variant="primary" onClick={() => setComposing(true)}>
                {t("empty.action")}
              </Button>
            </Row>
          ) : null}
        </Stack>
      ) : null}

      {create.isError ? (
        <Callout
          tone={isProblemOfType(create.error, PROBLEM.wipLimitReached) ? "warning" : "danger"}
          live
        >
          {/* `detail` is already in the user's language — that is the entire reason the
              server resolves it from the stored profile. */}
          <Text>{describe(create.error, common)}</Text>
          {isProblemOfType(create.error, PROBLEM.wipLimitReached) ? (
            <Text>{t("wip.atLimitHint")}</Text>
          ) : null}
        </Callout>
      ) : null}

      {setParked.isError ? (
        <Callout tone="danger" live>
          {describe(setParked.error, common)}
        </Callout>
      ) : null}

      {composing ? (
        <NewMissionForm
          onSubmit={submit}
          pending={create.isPending}
          onCancel={() => setComposing(false)}
          serverErrors={fieldErrorsFrom(create.isError ? create.error : null, t)}
        />
      ) : null}

      {!composing && all.length > 0 ? (
        <Row>
          {/* "New mission", not "Create mission": this opens the form, and giving the
              trigger the submit button's label makes the two indistinguishable to a
              screen reader reading the page out. */}
          <Button variant="primary" onClick={() => setComposing(true)} disabled={atLimit}>
            {t("new.open")}
          </Button>
          {/* Says why the button is off rather than leaving it inexplicably disabled. */}
          {atLimit ? (
            <Text as="span" tone="hint">
              {t("wip.full", { limit: MISSION_WIP_LIMIT })}
            </Text>
          ) : null}
        </Row>
      ) : null}

      <Stack>
        {all.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            pending={setParked.isPending && setParked.variables?.id === mission.id}
            note={renderNote?.(mission.id)}
            teach={renderTeach?.(mission.id)}
            curriculum={renderCurriculumLink?.(mission.id)}
            onTogglePark={(target: Mission) =>
              setParked.mutate({ id: target.id, parked: target.status === "active" })
            }
          />
        ))}
      </Stack>
    </Stack>
  );
}

/**
 * A request that never arrived has no translated `detail`, so the copy comes from the
 * bundle. Everything else already carries a sentence in the right language.
 */
function describe(error: unknown, common: (key: string) => string): string {
  if (error instanceof NetworkError) return common("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return common("error.unexpectedBody");
}
