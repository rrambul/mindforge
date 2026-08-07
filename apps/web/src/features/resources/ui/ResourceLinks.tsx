import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Callout,
  CardSection,
  ChipList,
  Label,
  RemovableChip,
  Row,
  Select,
  Text,
} from "../../../shared/ui/index.js";
import type { Resource } from "../api/use-resources.js";

export interface LinkTarget {
  readonly id: string;
  readonly name: string;
}

interface ResourceLinksProps {
  readonly resource: Resource;
  /** Names for the pickers, supplied by the app layer — a feature may not import another (§2.2 rule 6). */
  readonly missions: readonly LinkTarget[];
  readonly skills: readonly LinkTarget[];
  readonly onSetLinks: (links: { missionIds: string[]; skillIds: string[] }) => void;
  readonly pending: boolean;
  /**
   * Already translated. Rendered here rather than swallowed: linking is a considered act, not a
   * capture, so a refusal has to be visible — and the mutation lives in the screen, which has nowhere
   * near the card to put it.
   */
  readonly error?: string | null;
}

/**
 * What a resource is for (FR-R3).
 *
 * The requirement's own argument is why this exists: "an article you never connect to a goal is
 * entertainment". Until now the column was written only by the guided first mission, so every resource
 * captured afterwards was unattached — the feature's whole point was reachable from one screen in the
 * app.
 *
 * Chips plus a picker, the same shape as a skill's prerequisites, because it is the same problem: a
 * small set you mostly read and occasionally change. Deliberately **not** on the URL capture row — that
 * is the ≤5s path (FR-R2), and triage is what happens later when you have the attention for it. So the
 * link is set from the card, which also means it can be *changed* later rather than only at capture.
 *
 * **Missions and skills are listed separately**, each under its own word. They were one flat row of
 * identical chips, which threw away the only thing the row was there to say: "Rust ownership" and
 * "Borrowing" looked the same, so you could not tell the mission from the skill without knowing your
 * own data by heart. Two labelled rows cost one line and answer it outright.
 */
export function ResourceLinks({
  resource,
  missions,
  skills,
  onSetLinks,
  pending,
  error = null,
}: ResourceLinksProps) {
  const { t } = useTranslation("resources");
  const { t: g } = useTranslation("glossary");
  const [adding, setAdding] = useState<"mission" | "skill" | null>(null);
  const [chosen, setChosen] = useState("");

  const missionsById = new Map(missions.map((m) => [m.id, m.name] as const));
  const skillsById = new Map(skills.map((s) => [s.id, s.name] as const));

  const linkedMissions = new Set(resource.missionIds);
  const linkedSkills = new Set(resource.skillIds);

  const candidates = (adding === "mission" ? missions : skills).filter(
    (target) => !(adding === "mission" ? linkedMissions : linkedSkills).has(target.id),
  );
  const chosenId = chosen === "" ? (candidates[0]?.id ?? "") : chosen;

  /** Every write sends the whole set, because the endpoint replaces rather than merges. */
  function withMission(ids: readonly string[]): void {
    onSetLinks({ missionIds: [...ids], skillIds: [...resource.skillIds] });
  }
  function withSkill(ids: readonly string[]): void {
    onSetLinks({ missionIds: [...resource.missionIds], skillIds: [...ids] });
  }

  const nothingLinked = resource.missionIds.length === 0 && resource.skillIds.length === 0;

  return (
    <CardSection label={t("links.heading")}>
      {error === null ? null : (
        <Callout tone="danger" live>
          {error}
        </Callout>
      )}

      {/* Said rather than left blank. An unattached resource is the thing FR-R3 is warning about, so
          its absence is worth a sentence — not a nag, just the fact. */}
      {nothingLinked ? <Text tone="muted">{t("links.none")}</Text> : null}

      {/* The kind is named once, beside the row, rather than repeated on every chip. Both words come
          from the glossary, so the library and the missions screen cannot end up calling them
          different things (§5.2). */}
      {resource.missionIds.length === 0 ? null : (
        <Row>
          <Label>{g("mission_plural")}</Label>
          <ChipList label={g("mission_plural")}>
            {resource.missionIds.map((id) => (
              <li key={id}>
                <RemovableChip
                  removeLabel={t("links.remove")}
                  disabled={pending}
                  onRemove={() => withMission(resource.missionIds.filter((other) => other !== id))}
                >
                  {missionsById.get(id) ?? id}
                </RemovableChip>
              </li>
            ))}
          </ChipList>
        </Row>
      )}

      {resource.skillIds.length === 0 ? null : (
        <Row>
          <Label>{g("skill_plural")}</Label>
          <ChipList label={g("skill_plural")}>
            {resource.skillIds.map((id) => (
              <li key={id}>
                <RemovableChip
                  removeLabel={t("links.remove")}
                  disabled={pending}
                  onRemove={() => withSkill(resource.skillIds.filter((other) => other !== id))}
                >
                  {skillsById.get(id) ?? id}
                </RemovableChip>
              </li>
            ))}
          </ChipList>
        </Row>
      )}

      {adding === null ? (
        <Row>
          {/* Disabled with nothing to pick rather than hidden, so the absence of missions is visible
              instead of the control silently not being there. */}
          <Button
            variant="quiet"
            disabled={pending || missions.length === resource.missionIds.length}
            onClick={() => {
              setAdding("mission");
              setChosen("");
            }}
          >
            {t("links.addMission")}
          </Button>
          <Button
            variant="quiet"
            disabled={pending || skills.length === resource.skillIds.length}
            onClick={() => {
              setAdding("skill");
              setChosen("");
            }}
          >
            {t("links.addSkill")}
          </Button>
        </Row>
      ) : (
        <>
          <Select
            label={adding === "mission" ? t("links.pickMission") : t("links.pickSkill")}
            value={chosenId}
            onChange={(event) => setChosen(event.target.value)}
            options={candidates.map((target) => ({ value: target.id, label: target.name }))}
          />
          <Row>
            <Button
              disabled={chosenId === "" || pending}
              onClick={() => {
                if (chosenId === "") return;
                if (adding === "mission") withMission([...resource.missionIds, chosenId]);
                else withSkill([...resource.skillIds, chosenId]);
                setAdding(null);
                setChosen("");
              }}
            >
              {t("links.confirm")}
            </Button>
            <Button variant="quiet" onClick={() => setAdding(null)}>
              {t("add.close")}
            </Button>
          </Row>
        </>
      )}
    </CardSection>
  );
}
