import { useTranslation } from "react-i18next";

import { Card, Heading, Label, Stack, Text } from "../../../shared/ui/index.js";
import type { LearningRecord } from "../api/use-library.js";

/**
 * One learning record, field by field (FR-T6).
 *
 * **Not one paragraph.** The skill's format asks four separate questions — what
 * you learned, what proves it, what you struggled with, what is next — and running
 * them together makes the struggles as easy to skip as the evidence. They are the
 * two most worth reading again.
 *
 * An absent field is omitted rather than shown empty. The agent leaves `evidence`
 * blank when a lesson produced none, and a labelled blank reads as something
 * missing rather than as something that did not happen.
 */
export function LearningRecordCard({ record }: { readonly record: LearningRecord }) {
  const { t } = useTranslation("library");

  return (
    <Card as="article" variant="raised">
      <Stack gap="tight">
        <Heading level={3}>{record.title}</Heading>

        {record.lessonTitle === null ? null : (
          <Text tone="hint">{t("record.fromLesson", { lesson: record.lessonTitle })}</Text>
        )}

        <Field label={t("record.whatLearned")} value={record.whatLearned} />
        <Field label={t("record.keyInsight")} value={record.keyInsight} />
        <Field label={t("record.evidence")} value={record.evidence} />
        <Field label={t("record.struggles")} value={record.struggles} />
        <Field label={t("record.next")} value={record.next} />
      </Stack>
    </Card>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string | null }) {
  if (value === null || value.trim() === "") return null;

  return (
    <Stack gap="tight">
      <Label>{label}</Label>
      <Text>{value}</Text>
    </Stack>
  );
}
