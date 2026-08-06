import { SkillsRoute } from "../features/skills/routes/SkillsRoute.js";
import { SubjectNote } from "./SubjectNote.js";

/** Skills, with a note composer on every card (M1's "notes on anything"). See `ResourcesScreen`. */
export function SkillsScreen() {
  return (
    <SkillsRoute
      renderNote={(skillId) => <SubjectNote subjectType="skill" subjectId={skillId} />}
    />
  );
}
