import { Global, Module } from "@nestjs/common";
import { NightlyModule } from "./modules/nightly/presentation/nightly.module.js";
import { TeachModule } from "./modules/teach/presentation/teach.module.js";
import { CLOCK, SystemClock } from "./shared/clock.js";
import { ENV, loadEnv } from "./shared/env.js";
import { PRISMA, WorkerPrisma } from "./shared/prisma.js";

/**
 * The worker's composition root.
 *
 * Mirrors `apps/api/src/shared/shared.module.ts` in shape — `@Global()`, so a feature module imports
 * none of it — but not in content: no auth guard, no problem filter, no HTTP anything. The worker
 * serves nothing.
 *
 * `PRISMA` is provided from `WorkerPrisma` rather than directly, so the client has an owner with an
 * `onModuleDestroy` to close the pool. `main.ts` enables shutdown hooks; without a disconnect they
 * would drain nothing.
 *
 * The comment this file used to carry said the worker "reuses the API's use cases rather than
 * reimplementing writes". It cannot: `apps/worker` has no dependency on `apps/api`, and `apps/api`
 * is `private` with no `main`, no `types` and no `exports`. Where logic genuinely must be shared —
 * the `daily_activity` rollup — it lives in `packages/db`, and the domain maths it calls lives in
 * `packages/core`. The rule stands for M3's agent runs; it was never true of a rollup.
 */
@Global()
@Module({
  imports: [NightlyModule, TeachModule],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    WorkerPrisma,
    { provide: PRISMA, useFactory: (owner: WorkerPrisma) => owner.client, inject: [WorkerPrisma] },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [ENV, PRISMA, CLOCK],
})
export class WorkerModule {}
