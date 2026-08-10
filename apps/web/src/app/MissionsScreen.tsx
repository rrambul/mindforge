import { MissionsRoute } from "../features/missions/routes/MissionsRoute.js";
import { TeachPanel } from "../features/teach/ui/TeachPanel.js";

/**
 * Missions, composed with the feature a mission card needs and may not import:
 * the teach trigger (FR-T3).
 *
 * The same rule as every other wrapper in `app/` — §2.2 rule 6 forbids a
 * feature importing another, so the screen that composes both hands it in.
 */
export function MissionsScreen() {
  return <MissionsRoute renderTeach={(missionId) => <TeachPanel missionId={missionId} />} />;
}
