import { ResourcesRoute } from "../features/resources/routes/ResourcesRoute.js";
import { SubjectNote } from "./SubjectNote.js";

/**
 * The library, with a note composer on every resource (M1's "notes on anything").
 *
 * The wrapper exists so `features/resources` does not import `features/notes` — §2.2 rule 6 — and it
 * is the same shape as `GoalsScreen`. §3.7's second point is the reason this link matters more than it
 * looks: notes on a mission's resources are summarised into `BRIEFING.md`, so what you wrote while
 * reading shapes what the agent teaches you next.
 */
export function ResourcesScreen() {
  return (
    <ResourcesRoute
      renderNote={(resourceId) => <SubjectNote subjectType="resource" subjectId={resourceId} />}
    />
  );
}
