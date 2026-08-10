import { useTranslation } from "react-i18next";

import { Card, Heading, Stack, Text } from "../../../shared/ui/index.js";
import { useLearningRecords } from "../api/use-library.js";
import { LearningRecordCard } from "../ui/LearningRecordCard.js";

/**
 * What you wrote down about this lesson, under this lesson (FR-T6).
 *
 * Renders nothing at all while it is loading or when there are none — this is a
 * panel beneath a lesson, not a screen, and an empty "no records yet" card under
 * every unread lesson would be a permanent piece of furniture saying nothing. A
 * record appears when the teach run that wrote it has been indexed.
 *
 * A failed request is silent for the same reason: the lesson above it still works,
 * and an error banner about a side panel would be the loudest thing on a page
 * whose point is elsewhere.
 */
export function LessonRecords({
  missionId,
  lessonId,
}: {
  readonly missionId: string;
  readonly lessonId: string;
}) {
  const { t } = useTranslation("library");
  const query = useLearningRecords(missionId, lessonId);
  const records = query.data?.records ?? [];

  if (records.length === 0) return null;

  return (
    <Card as="section" label={t("records.forLesson")}>
      <Stack gap="tight">
        <Heading level={2}>{t("records.forLesson")}</Heading>
        <Text tone="hint">{t("records.hint")}</Text>
        {records.map((record) => (
          <LearningRecordCard key={record.id} record={record} />
        ))}
      </Stack>
    </Card>
  );
}
