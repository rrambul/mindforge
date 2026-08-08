import {
  CLOCK as API_CLOCK,
  ID_GENERATOR as API_ID_GENERATOR,
  PRISMA as API_PRISMA,
  USER_SCOPED_DB,
  type UserScopedDb,
} from "@mindforge/api/shared";
import type { PrismaClient, RlsTransaction } from "@mindforge/db";
import { Inject, Injectable, type Provider } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { CLOCK, type Clock } from "./clock.js";
import { PRISMA } from "./prisma.js";

/**
 * Satisfying what the API's use cases inject, inside the worker's container.
 *
 * §2.1 decision 2 says the worker calls the API's use cases rather than
 * reimplementing writes, and until M3 it could not: `apps/api` had no `exports`
 * map, so `@mindforge/api` was a workspace name that resolved to nothing while
 * `missions.module.ts` carried a dead `exports:` line saying otherwise. This file
 * is the other half of fixing that.
 *
 * **The tokens have to be the API's, not the worker's.** Both apps declare a
 * `CLOCK` symbol, and `Symbol("Clock") !== Symbol("Clock")` — the comment on
 * `shared/clock.ts` says the two DI containers never meet, which stopped being
 * true here. Binding the worker's symbol would leave the API's use cases
 * unresolvable with an error naming a token that looks identical to one that is
 * bound. So both are provided, aliased to one implementation each: same object,
 * two keys.
 *
 * **`SharedModule` itself is deliberately not imported.** It also provides
 * `APP_GUARD`, `APP_FILTER` and a Supabase JWKS verifier, and pulling it in would
 * make a process that serves no HTTP refuse to start without `SUPABASE_URL` —
 * the exact failure `env.ts` cites as the reason `REDIS_URL` is absent from its
 * schema.
 */

/**
 * The service-role counterpart `user-scoped-db.ts` predicted in M2.
 *
 * Same interface, no RLS. The worker connects as `postgres` with no JWT to
 * forward, so there is nothing for a policy to bind to — and this is the
 * dangerous half of the symmetry, stated plainly: **every query built on it must
 * name its `user_id` by hand** (§3.6, non-negotiable 1). What makes that
 * survivable rather than a hope is that `UserScopedDb.run` takes `userId` as a
 * required parameter, so a repository cannot issue a query without naming whose
 * data it touches — the signature is the enforcement, and it is identical on
 * both sides.
 */
@Injectable()
export class ServiceRoleDb implements UserScopedDb {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  run<R>(_userId: string, work: (tx: RlsTransaction) => Promise<R>): Promise<R> {
    // A transaction anyway, not because policies need one but because the
    // repositories were written against a transaction boundary: a method that
    // writes two tables atomically already has one, and taking it away here would
    // make the worker's version of the same call non-atomic.
    return this.prisma.$transaction((tx) => work(tx));
  }
}

@Injectable()
class WorkerIdGenerator {
  next(): string {
    return randomUUID();
  }
}

/**
 * Providers that make `@mindforge/api`'s use cases resolvable here.
 *
 * Registered in `WorkerModule`, which is `@Global()`, so a feature module that
 * imports `TeachModule` needs no `imports` of its own — the same arrangement
 * `NightlyModule` relies on.
 */
export const apiBindings: Provider[] = [
  WorkerIdGenerator,
  ServiceRoleDb,
  { provide: USER_SCOPED_DB, useExisting: ServiceRoleDb },
  { provide: API_PRISMA, useExisting: PRISMA },
  { provide: API_CLOCK, useExisting: CLOCK },
  { provide: API_ID_GENERATOR, useExisting: WorkerIdGenerator },
];

/** Re-exported so `WorkerModule` can list them in `exports` without a second import. */
export const API_TOKENS = [USER_SCOPED_DB, API_PRISMA, API_CLOCK, API_ID_GENERATOR] as const;

export type { Clock, UserScopedDb };
