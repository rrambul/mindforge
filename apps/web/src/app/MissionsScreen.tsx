import { useTranslation } from "react-i18next";

import { MissionsRoute } from "../features/missions/routes/MissionsRoute.js";
import { TeachPanel } from "../features/teach/ui/TeachPanel.js";
import { RouterLink } from "../shared/ui/index.js";

/**
 * Missions, composed with the feature a mission card needs and may not import:
 * the teach trigger (FR-T3).
 *
 * The same rule as every other wrapper in `app/` — §2.2 rule 6 forbids a
 * feature importing another, so the screen that composes both hands it in.
 */
export function MissionsScreen() {
  const { t } = useTranslation("missions");

  return (
    <MissionsRoute
      renderTeach={(missionId) => <TeachPanel missionId={missionId} />}
      // A link and not a button: a curriculum has a URL, and middle-click,
      // ⌘-click and a screen reader's link list are all things only an anchor does.
      renderCurriculumLink={(missionId) => (
        <RouterLink to={`/missions/${missionId}`}>{t("card.openCurriculum")}</RouterLink>
      )}
    />
  );
}
