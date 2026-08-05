import { MISSION_WIP_LIMIT, type CreateMissionInput } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, NetworkError, PROBLEM, isProblemOfType } from "../../../shared/api/problem.js";
import { Button } from "../../../shared/ui/Button.js";
import { Callout } from "../../../shared/ui/Callout.js";
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
export function MissionsRoute() {
  const { t } = useTranslation("missions");
  const { t: common } = useTranslation("common");
  const [composing, setComposing] = useState(false);

  const missions = useMissions();
  const create = useCreateMission();
  const setParked = useSetMissionParked();

  if (missions.isPending) {
    return <p className="mf-muted">{common("state.loading")}</p>;
  }

  if (missions.isError) {
    return (
      <Callout tone="danger" live>
        <p>{describe(missions.error, common)}</p>
        <div className="mf-row">
          <Button onClick={() => void missions.refetch()}>{common("action.retry")}</Button>
        </div>
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
    <div className="mf-stack">
      <div className="mf-spread">
        <h1 className="mf-h1">{t("heading")}</h1>
        {/* The WIP count is stated always, not only when it is reached. The limit is a
            product rule you are supposed to be aware of, and discovering it as a 409
            is the worse way to learn it. */}
        <span className="mf-label mf-figure">
          {t("wip.used", { used: activeCount, limit: MISSION_WIP_LIMIT })}
        </span>
      </div>

      {all.length === 0 ? (
        <div className="mf-stack">
          {/* Names one action and links to it — never an illustration and a shrug
              (§5.3). */}
          <p className="mf-muted">{t("empty.body")}</p>
          {!composing ? (
            <div className="mf-row">
              <Button variant="primary" onClick={() => setComposing(true)}>
                {t("empty.action")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {create.isError ? (
        <Callout
          tone={isProblemOfType(create.error, PROBLEM.wipLimitReached) ? "warning" : "danger"}
          live
        >
          {/* `detail` is already in the user's language — that is the entire reason the
              server resolves it from the stored profile. */}
          <p>{describe(create.error, common)}</p>
          {isProblemOfType(create.error, PROBLEM.wipLimitReached) ? (
            <p>{t("wip.atLimitHint")}</p>
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
        <div className="mf-row">
          {/* "New mission", not "Create mission": this opens the form, and giving the
              trigger the submit button's label makes the two indistinguishable to a
              screen reader reading the page out. */}
          <Button variant="primary" onClick={() => setComposing(true)} disabled={atLimit}>
            {t("new.open")}
          </Button>
          {/* Says why the button is off rather than leaving it inexplicably disabled. */}
          {atLimit ? (
            <span className="mf-hint">{t("wip.full", { limit: MISSION_WIP_LIMIT })}</span>
          ) : null}
        </div>
      ) : null}

      <div className="mf-stack">
        {all.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            pending={setParked.isPending && setParked.variables?.id === mission.id}
            onTogglePark={(target: Mission) =>
              setParked.mutate({ id: target.id, parked: target.status === "active" })
            }
          />
        ))}
      </div>
    </div>
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
