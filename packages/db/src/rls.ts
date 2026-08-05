/**
 * RLS claim forwarding — the mechanism behind FR-A3, "no cross-user reads
 * possible by construction".
 *
 * Two things have to be true for a Postgres policy to protect a Prisma query,
 * and getting either wrong fails **silently and open**: the query succeeds and
 * returns everyone's rows.
 *
 * 1. **The connection must not be the table owner or a superuser.** Prisma
 *    connects with DATABASE_URL, which is `postgres` — both. Policies do not
 *    apply to it at all, so setting `request.jwt.claims` alone changes nothing.
 *    `set local role authenticated` is what makes the policies bind, and it is
 *    transaction-local, so it cannot leak across a pooled connection.
 *
 * 2. **The query must run in the same transaction as the settings.** Prisma
 *    offers no hook for attaching session state to an operation, and the
 *    tempting shape — a `$extends({ query: { $allOperations } })` wrapper whose
 *    callback opens `$transaction(async tx => …)` and then calls `query(args)`
 *    — does not work: `query` is bound to the base client and runs on a
 *    *different* connection than `tx`. It looks right, type-checks, and
 *    isolates nothing.
 *
 * Both failure modes were verified against the real database rather than
 * reasoned about, and `test/rls.test.ts` pins them: `runAsUser` isolates, and
 * claims without the role switch do not.
 *
 * So the primitive here is explicit rather than transparent. Callers receive a
 * transaction client and issue queries on it. That costs a little more to type
 * than a magically-scoped client and buys two things worth having: it is
 * correct, and a repository method that must write two tables atomically
 * (a mission and its revision) already has its transaction.
 *
 * See TECH-DESIGN.md §3.6.
 */

import type { Prisma, PrismaClient } from "../generated/client/client.js";

/**
 * What `auth.uid()` reads. Shaped like a Supabase JWT payload because that is
 * exactly what it stands in for.
 */
export interface RlsClaims {
  readonly sub: string;
  readonly role: string;
}

/**
 * A Prisma client inside a transaction. It lacks `$transaction` and the
 * connection-lifecycle methods, which is why a nested `runAsUser` is a type
 * error rather than a runtime surprise.
 */
export type RlsTransaction = Prisma.TransactionClient;

/**
 * The role the policies are written against. Deliberately not a parameter: it
 * is a fixed part of the security model, and a caller-supplied role would be an
 * injection point in a statement that cannot use a placeholder.
 */
const AUTHENTICATED_ROLE = "authenticated";

const SET_CLAIMS = `select set_config('request.jwt.claims', $1, true)`;
const ASSUME_ROLE = `set local role ${AUTHENTICATED_ROLE}`;

/**
 * Run `fn` with the given user's claims in force, as the `authenticated` role.
 *
 * Everything `fn` does is one transaction: either all of it lands or none does.
 * Claims are set before the role switch, so `set_config` is called by the
 * privileged role — which keeps this working if Supabase ever tightens what
 * `authenticated` is allowed to configure.
 */
export function runAsUser<R>(
  prisma: PrismaClient,
  claims: RlsClaims,
  fn: (tx: RlsTransaction) => Promise<R>,
): Promise<R> {
  const serialized = JSON.stringify(claims);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(SET_CLAIMS, serialized);
    await tx.$executeRawUnsafe(ASSUME_ROLE);
    return fn(tx);
  });
}

/** The common case: a user id, with the role the policies expect. */
export function claimsFor(userId: string): RlsClaims {
  return { sub: userId, role: AUTHENTICATED_ROLE };
}
