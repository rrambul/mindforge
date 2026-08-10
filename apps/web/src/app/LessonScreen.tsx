import { useTranslation } from "react-i18next";

import { useCurriculum } from "../features/curriculum/api/use-curriculum.js";
import { StartLessonFocus } from "../features/focus/ui/StartLessonFocus.js";
import { LessonRoute } from "../features/lesson/routes/LessonRoute.js";
import { LessonRecords } from "../features/library/routes/LessonRecords.js";
import { TeachPanel } from "../features/teach/ui/TeachPanel.js";
import { Card, Heading, RouterLink, Stack, Text } from "../shared/ui/index.js";

/**
 * One lesson, composed with the three things the reader may not import (§2.2 rule 6):
 * the timer, the learning records, and what the plan says comes next.
 *
 * **"Next" is read from the curriculum, not from the reader.** Which lesson is next
 * is a fact about the whole dependency graph — it can be in another module, and it
 * can be locked by something you have not opened — so the answer comes from the one
 * query that has all of it, computed by `packages/core` on the server
 * (non-negotiable 3). The reader gets a rendered slot, not a rule.
 *
 * Both ids arrive as props rather than from `useParams`, for the reason
 * `CurriculumScreen` gives: reading them here would make this file depend on the
 * route table's types, and `router.tsx` already imports this file.
 */
export function LessonScreen({
  missionId,
  lessonId,
}: {
  readonly missionId: string;
  readonly lessonId: string;
}) {
  const { t } = useTranslation("lesson");

  return (
    <LessonRoute
      lessonId={lessonId}
      back={<RouterLink to={`/missions/${missionId}`}>{t("back")}</RouterLink>}
      focus={<StartLessonFocus lessonId={lessonId} />}
      next={<NextLesson missionId={missionId} lessonId={lessonId} />}
      records={<LessonRecords missionId={missionId} lessonId={lessonId} />}
    />
  );
}

/**
 * What the plan would have you do after this one (FR-K7).
 *
 * Three shapes, and the distinction is the point:
 *
 * - **The next lesson is this one.** Nothing is rendered. Suggesting the page you
 *   are on is noise, and it is the common case until you record an outcome.
 * - **The next lesson is written.** A link. Generating a new lesson while an unread
 *   one waits is how a curriculum turns into a backlog, which is why `nextLesson`
 *   in `packages/core` prefers the written one and says so.
 * - **The next lesson is planned.** It names the lesson and offers the teach
 *   button, because there is nothing to read yet and one press is what makes there
 *   be (FR-T3).
 *
 * Nothing at all while the curriculum is loading or has no plan: a slot at the foot
 * of the reader that says "we don't know yet" is a slot that is usually wrong.
 */
function NextLesson({
  missionId,
  lessonId,
}: {
  readonly missionId: string;
  readonly lessonId: string;
}) {
  const { t } = useTranslation("lesson");
  const curriculum = useCurriculum(missionId);

  const nextId = curriculum.data?.nextLessonId ?? null;
  if (nextId === null || nextId === lessonId) return null;

  const next = curriculum.data?.modules
    .flatMap((module) => module.lessons)
    .find((l) => l.id === nextId);
  if (next === undefined) return null;

  return (
    <Card as="section" label={t("next.heading")}>
      <Stack gap="tight">
        <Heading level={2}>{t("next.heading")}</Heading>
        <Text>{next.title}</Text>
        {next.intent === null ? null : <Text tone="hint">{next.intent}</Text>}

        {next.status === "generated" ? (
          <RouterLink to={`/missions/${missionId}/lessons/${next.id}`} variant="primary">
            {t("next.read")}
          </RouterLink>
        ) : (
          <Stack gap="tight">
            <Text tone="hint">{t("next.notWritten")}</Text>
            <TeachPanel missionId={missionId} />
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
