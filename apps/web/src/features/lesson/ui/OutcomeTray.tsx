import { LESSON_OUTCOMES, type LessonOutcome } from "@mindforge/core";
import { useTranslation } from "react-i18next";

import { Button, ChoiceGroup, Row, Stack, Text, type Choice } from "../../../shared/ui/index.js";

interface OutcomeTrayProps {
  readonly outcome: LessonOutcome | null;
  readonly onRecord: (outcome: LessonOutcome) => void;
  readonly onClear: () => void;
  readonly pending: boolean;
  /** Shown instead of the controls when the lesson has no content to finish. */
  readonly disabledReason?: string;
}

/**
 * How it went (FR-P1) — the second of the product's two capture paths, and the one
 * with the tighter budget.
 *
 * **Three chips, always visible, no confirmation.** §7.1 gives this five seconds
 * and two taps, and it uses one: the tray is on screen under the lesson rather
 * than behind a "finish" button, so recording an outcome is a single press. A
 * dialog would double the taps to ask a question the three chips already ask.
 *
 * **`shaky` sits in the middle and is not styled as a failure.** It is the honest
 * answer most of the time, and a red middle option teaches people to reach for
 * `understood` instead — which corrupts the one signal this screen exists to
 * collect (non-negotiable 10).
 *
 * **Undo is a plain link-weight button, not a second chip.** Clearing a completion
 * is a correction, not a fourth outcome, and giving it equal weight would make
 * "unread" look like something you can achieve.
 */
export function OutcomeTray({
  outcome,
  onRecord,
  onClear,
  pending,
  disabledReason,
}: OutcomeTrayProps) {
  const { t } = useTranslation("lesson");

  if (disabledReason !== undefined) return <Text tone="hint">{disabledReason}</Text>;

  const choices: readonly Choice<LessonOutcome>[] = LESSON_OUTCOMES.map((value) => ({
    value,
    label: t(`outcome.${value}`),
  }));

  return (
    <Stack gap="tight">
      <ChoiceGroup
        legend={t("outcome.legend")}
        choices={choices}
        value={outcome}
        onChange={onRecord}
      />

      {outcome === null ? (
        <Text tone="hint">{t("outcome.hint")}</Text>
      ) : (
        <Row>
          <Text tone="muted">{t("outcome.recorded", { outcome: t(`outcome.${outcome}`) })}</Text>
          <Button variant="quiet" disabled={pending} onClick={onClear}>
            {t("outcome.clear")}
          </Button>
        </Row>
      )}
    </Stack>
  );
}
