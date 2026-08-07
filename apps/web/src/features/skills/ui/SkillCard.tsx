import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardSection,
  Heading,
  Row,
  Spread,
  StatusChip,
  Text,
} from "../../../shared/ui/index.js";
import type { Skill } from "../api/use-skills.js";
import { CalibrationNote } from "./CalibrationNote.js";
import { PrerequisiteList } from "./PrerequisiteList.js";
import { RateSkillControl } from "./RateSkillControl.js";
import { SkillGauge } from "./SkillGauge.js";

interface SkillCardProps {
  readonly skill: Skill;
  readonly allSkills: readonly Skill[];
  readonly onRate: (skill: Skill, perceivedLevel: number) => void;
  readonly onAddPrerequisite: (skill: Skill, prereqId: string) => void;
  readonly onRemovePrerequisite: (skill: Skill, prereqId: string) => void;
  readonly onDelete: (skill: Skill) => void;
  readonly pending: boolean;
  /**
   * A note composer for this card, supplied by the app layer (M1's "notes on anything").
   *
   * A slot rather than an import: §2.2 rule 6 stops this feature reaching into notes, so the screen
   * that composes both hands it in. Optional, so the card still renders in a test that does not care.
   */
  readonly note?: ReactNode;
}

/**
 * Dumb by design: props in, markup out.
 *
 * The card is built in blocks rather than as one column of evenly spaced parts. It carries five
 * different kinds of thing — what the skill is, what the evidence says, what you claim, what has to
 * come first, and what you can do about it — and under a single gap they all had the same weight, so
 * finding the calibration sentence meant reading everything above it.
 */
export function SkillCard({
  skill,
  allSkills,
  onRate,
  onAddPrerequisite,
  onRemovePrerequisite,
  onDelete,
  pending,
  note,
}: SkillCardProps) {
  const { t } = useTranslation("skills");
  const { t: g } = useTranslation("glossary");

  return (
    // Labelled so each card is identifiable — a screen-reader user moving between them by role
    // otherwise hears "article" repeatedly with no way to tell which skill they are on.
    <Card as="article" label={skill.name}>
      <Spread>
        {/* A heading, not body copy: it is the card's title, and it was set in the same type as the
            description underneath it. */}
        <Heading level={2}>{skill.name}</Heading>
        {/* Translated from the derived band, never from a stored one — the band moves with decay. */}
        {skill.band === null ? null : <StatusChip>{g(`band.${skill.band}`)}</StatusChip>}
      </Spread>

      {skill.description ? <Text tone="muted">{skill.description}</Text> : null}

      {/* Evidence and calibration are one thought: the gauge is what has been shown, and the sentence
          is what that means next to what you claim. Separating them left the gap FR-S5 calls the
          highest-value thing here floating between two unrelated controls. */}
      <CardSection label={t("score.label")}>
        <SkillGauge skill={skill} />
        <CalibrationNote skill={skill} />
      </CardSection>

      <RateSkillControl skill={skill} pending={pending} onRate={(level) => onRate(skill, level)} />

      <PrerequisiteList
        skill={skill}
        allSkills={allSkills}
        pending={pending}
        onAdd={(prereqId) => onAddPrerequisite(skill, prereqId)}
        onRemove={(prereqId) => onRemovePrerequisite(skill, prereqId)}
      />

      {note === undefined ? null : <CardSection>{note}</CardSection>}

      <CardSection>
        <Row>
          <Button variant="quiet" onClick={() => onDelete(skill)} disabled={pending}>
            {t("delete")}
          </Button>
        </Row>
      </CardSection>
    </Card>
  );
}
