import { GoalsRoute } from "../features/goals/routes/GoalsRoute.js";
import { useMissions } from "../features/missions/api/use-missions.js";
import { useResources } from "../features/resources/api/use-resources.js";

/**
 * Composes the goals screen with the things a target can point at.
 *
 * This layer exists precisely so `features/goals` does not have to import `features/missions` and
 * `features/resources` — §2.2 rule 6, and the boundary rule enforces it. Cross-feature composition is
 * the app layer's job, which is the same reason `TodayScreen` exists.
 *
 * Skills are deliberately absent: they have no screen yet, and `AddTargetForm` says so rather than
 * offering an empty picker.
 */
export function GoalsScreen() {
  const resources = useResources({});
  const missions = useMissions();

  return (
    <GoalsRoute
      resources={resources.data?.resources ?? []}
      missions={missions.data?.missions ?? []}
    />
  );
}
