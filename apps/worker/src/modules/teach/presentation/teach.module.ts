import { TeachModule as ApiTeachModule } from "@mindforge/api/teach";
import { Module } from "@nestjs/common";

import { WorkspaceSync } from "../application/workspace-sync.js";
import { WORKSPACE_GATEWAY } from "../application/workspace.port.js";
import { SupabaseWorkspaceGateway } from "../infrastructure/supabase-workspace.gateway.js";

/**
 * §10's `teach:generate-lesson` and `teach:sync-workspace`.
 *
 * No `imports`, like `NightlyModule`: `WorkerModule` is `@Global()` and provides
 * `ENV`, `PRISMA` and `CLOCK`, so a feature module that declared them would get a
 * second instance of each. The one that matters is `PRISMA` — a second client is
 * a second connection pool that nothing closes on shutdown.
 *
 * This is also the file the boundary rule exempts, because binding an interface
 * to an implementation cannot be written without naming the implementation.
 */
@Module({
  imports: [ApiTeachModule],
  providers: [WorkspaceSync, { provide: WORKSPACE_GATEWAY, useClass: SupabaseWorkspaceGateway }],
  exports: [WorkspaceSync, ApiTeachModule],
})
export class TeachModule {}
