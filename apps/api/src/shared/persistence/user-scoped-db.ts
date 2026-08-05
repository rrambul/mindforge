import { claimsFor, runAsUser, type PrismaClient, type RlsTransaction } from "@mindforge/db";
import { Inject, Injectable } from "@nestjs/common";

export const PRISMA = Symbol("Prisma");
export const USER_SCOPED_DB = Symbol("UserScopedDb");

/**
 * The only way infrastructure reaches the database.
 *
 * `userId` is a parameter rather than ambient state, which makes CLAUDE.md's
 * first non-negotiable structural instead of a review checklist item: a
 * repository *cannot* issue a query without naming whose data it is touching.
 * That is the thing standing between the worker — which will hold a service-role
 * connection that bypasses RLS entirely (TECH-DESIGN.md §3.6) — and a
 * cross-user leak.
 *
 * `run` is also the transaction boundary. A repository method that must write two
 * tables atomically already has one, which is why this is a callback rather than
 * a scoped client handed out and used freely.
 */
export interface UserScopedDb {
  run<R>(userId: string, work: (tx: RlsTransaction) => Promise<R>): Promise<R>;
}

/**
 * The request-path implementation: Postgres policies do the enforcing.
 *
 * A singleton despite being per-user, because the user is an argument. The
 * service-role counterpart the worker needs lands with M3, implementing the same
 * interface so use cases are unaware of which one they have.
 */
@Injectable()
export class RlsScopedDb implements UserScopedDb {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  run<R>(userId: string, work: (tx: RlsTransaction) => Promise<R>): Promise<R> {
    return runAsUser(this.prisma, claimsFor(userId), work);
  }
}
