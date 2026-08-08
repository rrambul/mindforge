/**
 * What `apps/worker` may import from the teach module.
 *
 * Deliberately narrow: use cases, the tokens needed to bind them, and the types
 * they speak in. **No infrastructure.** The worker binds its own service-role
 * `UserScopedDb` to `USER_SCOPED_DB` and reuses these use cases unchanged — which
 * is §2.1 decision 2 working ("the worker calls the API's use cases; it does not
 * reimplement writes") rather than being asserted in a comment.
 *
 * Exporting `PrismaAgentRunRepository` from here would be the moment that stops
 * being true: the worker would then have two ways to write `agent_runs`, and the
 * second one would drift.
 */

export { TeachRuns } from "./application/teach.use-cases.js";
export { TeachModule } from "./presentation/teach.module.js";

export { BRIEFING_READER, type BriefingReader } from "./application/briefing.port.js";

export {
  MISSION_WORKSPACE_READER,
  type MissionWorkspace,
  type MissionWorkspaceReader,
} from "./application/teach.port.js";

export {
  ACTIVE_STATUSES,
  HEARTBEAT_TIMEOUT_MS,
  canTransition,
  isActive,
  isStale,
  isTerminal,
  type AgentRun,
  type AgentRunKind,
  type AgentRunResult,
  type AgentRunStatus,
} from "./domain/agent-run.js";

export {
  AGENT_RUN_REPOSITORY,
  type AgentRunRepository,
  type CreateAgentRun,
  type FinishAgentRun,
} from "./domain/agent-run.repository.js";

export {
  AgentRunNotFound,
  RunAlreadyActive,
  RunTransitionInvalid,
  WorkspaceKeyUnavailable,
} from "./domain/errors.js";
