import { allPrerequisites, type PrereqEdge } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  CardSection,
  ChipList,
  RemovableChip,
  Row,
  Select,
  Text,
} from "../../../shared/ui/index.js";
import type { Skill } from "../api/use-skills.js";

interface PrerequisiteListProps {
  readonly skill: Skill;
  readonly allSkills: readonly Skill[];
  readonly onAdd: (prereqId: string) => void;
  readonly onRemove: (prereqId: string) => void;
  readonly pending: boolean;
}

/**
 * A skill's direct prerequisites, and the picker for adding one.
 *
 * The picker leaves out anything that would close a loop — itself, whatever it already requires, and
 * **anything that transitively depends on it**. That last case is the one worth the code: the server
 * refuses it with a 409 either way, and offering a choice the server will reject wastes a round trip to
 * be told no. The same `allPrerequisites` function decides it in both places, so they cannot disagree.
 *
 * The exclusion is stated rather than silent, because a name missing from a list with no explanation
 * reads as a bug.
 *
 * The chips and the add button share one line. As four stacked rows — a caption, the chips, each with
 * its own underlined "Remove", then the button — this was the longest block on a card whose actual
 * content is usually two words.
 */
export function PrerequisiteList({
  skill,
  allSkills,
  onAdd,
  onRemove,
  pending,
}: PrerequisiteListProps) {
  const { t } = useTranslation("skills");
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState("");

  const byId = new Map(allSkills.map((candidate) => [candidate.id, candidate] as const));

  // Every edge in the graph, rebuilt from what the list already returned — no extra request, since each
  // skill carries its own direct prerequisites.
  const edges: PrereqEdge[] = allSkills.flatMap((candidate) =>
    candidate.prerequisiteIds.map((prereqId) => ({ skillId: candidate.id, prereqId })),
  );

  const currentPrereqs = new Set(skill.prerequisiteIds);
  const candidates = allSkills.filter((candidate) => {
    if (candidate.id === skill.id) return false;
    if (currentPrereqs.has(candidate.id)) return false;
    // Would close a loop: this skill is already somewhere in the candidate's own chain.
    return !allPrerequisites(edges, candidate.id).has(skill.id);
  });

  const anyExcluded = candidates.length < allSkills.length - 1 - skill.prerequisiteIds.length;
  const chosenId = chosen === "" ? (candidates[0]?.id ?? "") : chosen;

  return (
    // The caption is the section's, rather than a muted line of body copy pretending to be a heading.
    <CardSection label={t("prerequisites.heading")}>
      {adding && candidates.length > 0 ? (
        <>
          <Select
            label={t("prerequisites.pick")}
            value={chosenId}
            onChange={(event) => setChosen(event.target.value)}
            options={candidates.map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
            }))}
          />
          {/* Said out loud: a name missing from the list with no explanation reads as a bug. */}
          {anyExcluded ? <Text tone="muted">{t("prerequisites.cycleWarning")}</Text> : null}
          <Row>
            <Button
              onClick={() => {
                if (chosenId === "") return;
                onAdd(chosenId);
                setChosen("");
                setAdding(false);
              }}
              disabled={chosenId === "" || pending}
            >
              {t("prerequisites.confirm")}
            </Button>
            <Button variant="quiet" onClick={() => setAdding(false)}>
              {t("create.close")}
            </Button>
          </Row>
        </>
      ) : (
        <Row>
          {skill.prerequisiteIds.length === 0 ? (
            <Text as="span" tone="muted">
              {t("prerequisites.none")}
            </Text>
          ) : (
            <ChipList label={t("prerequisites.heading")}>
              {skill.prerequisiteIds.map((prereqId) => (
                <li key={prereqId}>
                  <RemovableChip
                    removeLabel={t("prerequisites.remove")}
                    disabled={pending}
                    onRemove={() => onRemove(prereqId)}
                  >
                    {byId.get(prereqId)?.name ?? prereqId}
                  </RemovableChip>
                </li>
              ))}
            </ChipList>
          )}

          <Button
            variant="quiet"
            onClick={() => setAdding(true)}
            // Nothing left to pick: every other skill is already required or would close a loop.
            disabled={candidates.length === 0 || pending}
          >
            {t("prerequisites.add")}
          </Button>
        </Row>
      )}
    </CardSection>
  );
}
