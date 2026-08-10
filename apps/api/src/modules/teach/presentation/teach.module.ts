import { Module } from "@nestjs/common";

import { ENV, type Env } from "../../../shared/config/env.js";
import { MissionsModule } from "../../missions/presentation/missions.module.js";
import { ResourcesModule } from "../../resources/presentation/resources.module.js";
import { SkillsModule } from "../../skills/presentation/skills.module.js";
import { BRIEFING_READER } from "../application/briefing.port.js";
import { WORKSPACE_INDEX_REPOSITORY } from "../application/index.port.js";
import { LearnerMemories } from "../application/learner-memories.js";
import { MEMORY_FILE_STORE, MEMORY_STORAGE_CONFIG } from "../application/memory-file.port.js";
import { LEARNER_MEMORY_REPOSITORY } from "../application/memory.port.js";
import { ReindexLearnerMemory } from "../application/reindex-memory.js";
import { ReindexWorkspace } from "../application/reindex-workspace.js";
import { MISSION_WORKSPACE_READER } from "../application/teach.port.js";
import { TeachRuns } from "../application/teach.use-cases.js";
import { AGENT_RUN_REPOSITORY } from "../domain/agent-run.repository.js";
import { PrismaAgentRunRepository } from "../infrastructure/prisma-agent-run.repository.js";
import { PrismaBriefingReader } from "../infrastructure/prisma-briefing.reader.js";
import { PrismaLearnerMemoryRepository } from "../infrastructure/prisma-learner-memory.repository.js";
import { PrismaMissionWorkspaceReader } from "../infrastructure/prisma-mission-workspace.reader.js";
import { PrismaWorkspaceIndexRepository } from "../infrastructure/prisma-workspace-index.repository.js";
import { SupabaseMemoryFileStore } from "../infrastructure/supabase-memory-file.store.js";
import { LearnerMemoryController, TeachController } from "./teach.controller.js";

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
  // The rule working rather than an exception to it: reindexing `MISSION.md`,
  // `RESOURCES.md` and `CURRICULUM.md` must each go through the module that owns
  // the table, so this module imports their exported use cases rather than
  // writing three tables it does not own.
  imports: [MissionsModule, ResourcesModule, SkillsModule],
  controllers: [TeachController, LearnerMemoryController],
  providers: [
    TeachRuns,
    ReindexWorkspace,
    ReindexLearnerMemory,
    LearnerMemories,
    { provide: AGENT_RUN_REPOSITORY, useClass: PrismaAgentRunRepository },
    { provide: MISSION_WORKSPACE_READER, useClass: PrismaMissionWorkspaceReader },
    { provide: BRIEFING_READER, useClass: PrismaBriefingReader },
    { provide: WORKSPACE_INDEX_REPOSITORY, useClass: PrismaWorkspaceIndexRepository },
    { provide: LEARNER_MEMORY_REPOSITORY, useClass: PrismaLearnerMemoryRepository },
    { provide: MEMORY_FILE_STORE, useClass: SupabaseMemoryFileStore },
    {
      // Derived from whichever `Env` this container has, which is what lets the
      // same module boot in `apps/worker` — its env declares both of these under
      // the same names and nothing else the store needs.
      provide: MEMORY_STORAGE_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        supabaseUrl: env.SUPABASE_URL,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      }),
    },
  ],
  exports: [TeachRuns, ReindexWorkspace, ReindexLearnerMemory, BRIEFING_READER],
})
export class TeachModule {}
