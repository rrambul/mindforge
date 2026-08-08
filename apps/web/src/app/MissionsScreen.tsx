import { MissionsRoute } from "../features/missions/routes/MissionsRoute.js";
import { TeachPanel } from "../features/teach/ui/TeachPanel.js";
import { SubjectNote } from "./SubjectNote.js";

/**
 * Missions, composed with the two features a mission card needs and may not
 * import: a note composer (M1's "notes on anything") and the teach trigger
 * (M3's FR-T3).
 *
 * The tenth wrapper in `app/`, and the same rule as the other nine — §2.2 rule 6
 * forbids a feature importing another, so the screen that composes both hands
 * them in. See `ResourcesScreen`.
 */
export function MissionsScreen() {
  return (
    <MissionsRoute
      renderTeach={(missionId) => <TeachPanel missionId={missionId} />}
      renderNote={(missionId) => <SubjectNote subjectType="mission" subjectId={missionId} />}
    />
  );
}
