import { createPrismaClient, type PrismaClient } from "@mindforge/db";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { ENV, type Env } from "./env.js";

export const PRISMA = Symbol("Prisma");

/**
 * The worker's connection, and the thing that closes it.
 *
 * `apps/api` gets away without an explicit disconnect because a web process is killed with requests
 * in flight anyway. A worker is different: `main.ts` calls `enableShutdownHooks()`, so SIGTERM
 * drains — and a pool that is never closed turns a clean shutdown into a thirty-second wait for the
 * event loop to give up, which on a platform with a restart timeout reads as a crash.
 *
 * Unlike the API's `RlsScopedDb`, nothing here scopes by user. That is deliberate and it is the
 * dangerous part: this connection bypasses RLS, so every query built on it must name its `user_id`
 * by hand (§3.6, CLAUDE.md non-negotiable 1).
 */
@Injectable()
export class WorkerPrisma implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient(env.DATABASE_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
