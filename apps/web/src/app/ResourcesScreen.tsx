import { useTranslation } from "react-i18next";
import { useMissions } from "../features/missions/api/use-missions.js";
import { useSetResourceLinks, type Resource } from "../features/resources/api/use-resources.js";
import { ResourcesRoute } from "../features/resources/routes/ResourcesRoute.js";
import { ResourceLinks } from "../features/resources/ui/ResourceLinks.js";
import { useSkills } from "../features/skills/api/use-skills.js";
import { ApiError, NetworkError } from "../shared/api/problem.js";
import { SubjectNote } from "./SubjectNote.js";

/**
 * The library, with a note composer and a link editor on every resource.
 *
 * The wrapper exists so `features/resources` imports neither `features/notes` nor the mission and skill
 * features — §2.2 rule 6 — and it is the same shape as `GoalsScreen`.
 *
 * §3.7's second point is why the note link matters more than it looks: notes on a mission's resources
 * are summarised into `BRIEFING.md`, so what you wrote while reading shapes what the agent teaches you
 * next. FR-R3 is why the mission and skill links matter — an article you never connect to a goal is
 * entertainment, and until now only the guided first mission ever wrote that connection.
 */
export function ResourcesScreen() {
  const { t: common } = useTranslation("common");
  const missions = useMissions();
  const skills = useSkills({});
  const setLinks = useSetResourceLinks();

  return (
    <ResourcesRoute
      renderNote={(resourceId) => <SubjectNote subjectType="resource" subjectId={resourceId} />}
      renderLinks={(resource: Resource) => (
        <ResourceLinks
          resource={resource}
          missions={(missions.data?.missions ?? []).map((mission) => ({
            id: mission.id,
            name: mission.topic,
          }))}
          skills={(skills.data?.skills ?? []).map((skill) => ({
            id: skill.id,
            name: skill.name,
          }))}
          pending={setLinks.isPending && setLinks.variables?.id === resource.id}
          error={
            setLinks.variables?.id === resource.id
              ? describeLinkError(setLinks.error, common)
              : null
          }
          onSetLinks={(links) => setLinks.mutate({ id: resource.id, links })}
        />
      )}
    />
  );
}

function describeLinkError(error: unknown, common: (key: string) => string): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof NetworkError) return common("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return common("error.unexpectedBody");
}
