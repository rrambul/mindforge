import { useTranslation } from "react-i18next";

import { useCurriculum } from "../features/curriculum/api/use-curriculum.js";
import { BridgeOffer } from "../features/teach/ui/BridgeOffer.js";
import { Card, Heading, RouterLink, Stack } from "../shared/ui/index.js";

/**
 * "Try an easier version", for a lesson that landed too hard (FR-D2).
 *
 * Read from the curriculum rather than the reader, because the verdict is derived
 * there once, server-side, from attempts, hints and the outcome — the reader
 * computing its own would be the second implementation non-negotiable 3 forbids.
 * Nothing for any other verdict, and nothing for an unknown one: an offer of an
 * easier version for a lesson nobody has finished would be a guess.
 */
export function EasierVersion({
  missionId,
  lessonId,
}: {
  readonly missionId: string;
  readonly lessonId: string;
}) {
  const { t } = useTranslation("lesson");
  const curriculum = useCurriculum(missionId);

  const lesson = curriculum.data?.modules
    .flatMap((module) => module.lessons)
    .find((l) => l.id === lessonId);
  if (lesson === undefined || lesson.strain.verdict !== "too-hard") return null;

  return (
    <Card as="section" label={t("easier.heading")}>
      <Stack gap="tight">
        <Heading level={2}>{t("easier.heading")}</Heading>
        <BridgeOffer
          missionId={missionId}
          lessonId={lessonId}
          {...(lesson.bridge === null
            ? {}
            : {
                existing: (
                  <RouterLink to={`/missions/${missionId}/lessons/${lesson.bridge.id}`}>
                    {lesson.bridge.title}
                  </RouterLink>
                ),
              })}
        />
      </Stack>
    </Card>
  );
}
