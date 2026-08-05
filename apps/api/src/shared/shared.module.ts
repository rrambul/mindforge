import { createPrismaClient, type PrismaClient } from "@mindforge/db";
import { Global, Inject, Module, type OnModuleDestroy, type Provider } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { PROFILE_READER, PrismaProfileReader } from "./auth/profile-reader.js";
import { SupabaseAuthGuard } from "./auth/supabase-auth.guard.js";
import { SupabaseJwtVerifier, TOKEN_VERIFIER } from "./auth/token-verifier.js";
import { ENV, loadEnv, type Env } from "./config/env.js";
import { ProblemExceptionFilter } from "./http/problem.filter.js";
import { ID_GENERATOR, UuidGenerator } from "./ids/id-generator.js";
import { PRISMA, RlsScopedDb, USER_SCOPED_DB } from "./persistence/user-scoped-db.js";
import { CLOCK, SystemClock } from "./time/clock.js";

const providers: Provider[] = [
  { provide: ENV, useFactory: () => loadEnv() },
  {
    provide: PRISMA,
    inject: [ENV],
    useFactory: (env: Env) => createPrismaClient(env.DATABASE_URL),
  },
  { provide: CLOCK, useClass: SystemClock },
  { provide: ID_GENERATOR, useClass: UuidGenerator },
  { provide: USER_SCOPED_DB, useClass: RlsScopedDb },
  { provide: TOKEN_VERIFIER, useClass: SupabaseJwtVerifier },
  { provide: PROFILE_READER, useClass: PrismaProfileReader },

  // Global, with @Public() as the opt-out. Registering the guard here rather
  // than in main.ts is what lets it inject — a guard passed to
  // app.useGlobalGuards() is constructed outside the injector.
  { provide: APP_GUARD, useClass: SupabaseAuthGuard },
  { provide: APP_FILTER, useClass: ProblemExceptionFilter },
];

/**
 * Cross-cutting wiring, `@Global()` so feature modules need not re-import it.
 *
 * Global modules are usually a smell — they hide dependencies. These are the
 * exception the pattern exists for: the environment, the clock, the database
 * handle, and the auth chain are needed by every module, and threading them
 * through fourteen `imports` arrays communicates nothing.
 */
@Global()
@Module({
  providers,
  exports: [ENV, PRISMA, CLOCK, ID_GENERATOR, USER_SCOPED_DB, TOKEN_VERIFIER, PROFILE_READER],
})
export class SharedModule implements OnModuleDestroy {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * The connection pool is opened by a factory, so nothing else would ever close it.
   *
   * Two consequences of leaving it open, both real: a SIGTERM drops in-flight
   * queries instead of draining them, and an integration suite that calls
   * `app.close()` still holds sockets, so Vitest reports the run as complete and then
   * refuses to exit.
   */
  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
