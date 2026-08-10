import { useTranslation } from "react-i18next";

import { CurriculumRoute } from "../features/curriculum/routes/CurriculumRoute.js";
import { useMissions } from "../features/missions/api/use-missions.js";
import { TeachPanel } from "../features/teach/ui/TeachPanel.js";
import { RouterLink, Row } from "../shared/ui/index.js";

/**
 * One mission's curriculum, composed with the things the feature may not
 * import (§2.2 rule 6): the mission it belongs to, the teach trigger, and the two
 * routes that lead out of it — a lesson, and the library.
 *
 * The id arrives as a prop rather than from `useParams` here: reading it inside the
 * screen would make this file depend on the route table's types, and `router.tsx`
 * already imports this file — a type cycle that resolves to `any` and takes the
 * mission id's type with it. The route reads its own params, which it can do
 * concretely, and hands the string down.
 *
 * The topic comes from the missions list rather than a fetch of its own — it is
 * already in the cache when you arrive from the card, and a second request for a
 * heading would make the page load twice as slowly to say the same word. Undefined
 * while it is not there, and the route falls back to the screen's own name rather
 * than rendering a gap.
 */
export function CurriculumScreen({ missionId }: { readonly missionId: string }) {
  const { t } = useTranslation("curriculum");
  const missions = useMissions();
  const mission = missions.data?.missions.find((candidate) => candidate.id === missionId);

  return (
    <CurriculumRoute
      missionId={missionId}
      {...(mission ? { topic: mission.topic } : {})}
      teach={<TeachPanel missionId={missionId} />}
      library={
        <Row>
          <RouterLink to={`/missions/${missionId}/library`}>{t("library")}</RouterLink>
        </Row>
      }
      // Only a written lesson gets one. A link to a file that does not exist is
      // worse than no link, and the planned line already says why there is none.
      lessonLink={(lesson) =>
        lesson.status === "generated" ? (
          <RouterLink to={`/missions/${missionId}/lessons/${lesson.id}`}>
            {lesson.completed ? t("lesson.reread") : t("lesson.read")}
          </RouterLink>
        ) : null
      }
    />
  );
}
