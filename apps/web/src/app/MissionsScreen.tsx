import { MissionsRoute } from "../features/missions/routes/MissionsRoute.js";
import { SubjectNote } from "./SubjectNote.js";

/** Missions, with a note composer on every card (M1's "notes on anything"). See `ResourcesScreen`. */
export function MissionsScreen() {
  return (
    <MissionsRoute
      renderNote={(missionId) => <SubjectNote subjectType="mission" subjectId={missionId} />}
    />
  );
}
