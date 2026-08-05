import type { DebriefFocusSessionInput, IntentionOutcome } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Heading, Row, Stack } from "../../../shared/ui/index.js";
import { OutcomeChips, RatingRow } from "./debrief-controls.js";

interface DebriefProps {
  readonly onSubmit: (debrief: DebriefFocusSessionInput) => void;
  readonly onSkip: () => void;
  readonly pending: boolean;
}

/**
 * The ≤30-second debrief (FR-F3).
 *
 * Three questions, all answerable by tapping, none required — and **Skip is a first-class button,
 * not a dismissal**. A debrief you cannot decline is one you learn to answer carelessly, and
 * careless is worse than absent: `producedLearning` reads `hitIntention`, so a reflexive "yes" would
 * inflate the ember share permanently.
 *
 * Submit stays disabled until something is answered, because an empty debrief is a mistake rather
 * than an answer — and Skip is right there for when nothing is what you mean.
 */
export function Debrief({ onSubmit, onSkip, pending }: DebriefProps) {
  const { t } = useTranslation("focus");
  const [hitIntention, setHitIntention] = useState<IntentionOutcome | null>(null);
  const [focusQuality, setFocusQuality] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);

  const answered = hitIntention !== null || focusQuality !== null || energy !== null;

  function submit(): void {
    onSubmit({
      ...(hitIntention === null ? {} : { hitIntention }),
      ...(focusQuality === null ? {} : { focusQuality }),
      ...(energy === null ? {} : { energy }),
    });
  }

  return (
    <Card as="section" label={t("debrief.label")}>
      <Stack>
        <Heading level={2}>{t("debrief.heading")}</Heading>

        <OutcomeChips
          legend={t("debrief.hitIntention")}
          value={hitIntention}
          onChange={setHitIntention}
        />
        <RatingRow
          legend={t("debrief.focusQuality")}
          value={focusQuality}
          onChange={setFocusQuality}
        />
        <RatingRow legend={t("debrief.energy")} value={energy} onChange={setEnergy} />

        <Row>
          <Button variant="primary" onClick={submit} disabled={pending || !answered}>
            {pending ? t("debrief.saving") : t("debrief.save")}
          </Button>
          {/* Not quiet: declining is a legitimate answer and should look like one. */}
          <Button onClick={onSkip} disabled={pending}>
            {t("debrief.skip")}
          </Button>
        </Row>
      </Stack>
    </Card>
  );
}
