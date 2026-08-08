import { Module } from "@nestjs/common";

import { BRIEFING_READER } from "../application/briefing.port.js";
import { MISSION_WORKSPACE_READER } from "../application/teach.port.js";
import { TeachRuns } from "../application/teach.use-cases.js";
import { AGENT_RUN_REPOSITORY } from "../domain/agent-run.repository.js";
import { PrismaAgentRunRepository } from "../infrastructure/prisma-agent-run.repository.js";
import { PrismaBriefingReader } from "../infrastructure/prisma-briefing.reader.js";
import { PrismaMissionWorkspaceReader } from "../infrastructure/prisma-mission-workspace.reader.js";
import { TeachController } from "./teach.controller.js";

/**
 * `teach` (§6) — FR-T3.
 *
 * **`exports` here is consumed, unlike the one on `missions.module.ts`.** That
 * module has carried `exports: [CreateMission, …]` since M1 with a comment saying
 * the worker would call them directly, and nothing could: `apps/api` declared no
 * `main`, no `types` and no `exports` map, so `@mindforge/api` was a workspace
 * name that resolved to nothing. M3 is the milestone that forces the issue,
 * because the worker has to claim, heartbeat and finish runs — writes to a table
 * this module owns.
 *
 * The rest of the wiring is unchanged from every other module because it can be:
 * `SharedModule` is `@Global()`, and `TeachRuns` depends on `USER_SCOPED_DB`,
 * `CLOCK` and `ID_GENERATOR` rather than on any of their implementations. The
 * worker binds a service-role `UserScopedDb` to the same token, which is what
 * `shared/persistence/user-scoped-db.ts` predicted in M2 — "the service-role
 * counterpart the worker needs lands with M3, implementing the same interface so
 * use cases are unaware of which one they have."
 *
 * This file names implementations, which the boundary rule exempts `*.module.ts`
 * from for exactly this reason: a composition root cannot bind an abstraction
 * without naming what it binds to.
 */
@Module({
  controllers: [TeachController],
  providers: [
    TeachRuns,
    { provide: AGENT_RUN_REPOSITORY, useClass: PrismaAgentRunRepository },
    { provide: MISSION_WORKSPACE_READER, useClass: PrismaMissionWorkspaceReader },
    { provide: BRIEFING_READER, useClass: PrismaBriefingReader },
  ],
  exports: [TeachRuns, BRIEFING_READER],
})
export class TeachModule {}
