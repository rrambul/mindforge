/**
 * RLS claim forwarding.
 *
 * Prisma has no hook for passing a JWT through to Postgres, so every operation
 * is wrapped in a transaction that sets the claim first. `set_config(..., true)`
 * is transaction-LOCAL — the `true` is load-bearing. Without it the setting
 * leaks across pooled connections and one user's claims apply to another's
 * query. See TECH-DESIGN.md §3.6.
 *
 * Typed structurally here because @prisma/client is not generated until the
 * schema exists; this tightens to the real PrismaClient in the same commit
 * that adds the schema.
 */

export interface RlsClaims {
  readonly sub: string;
  readonly role: string;
}

interface TxLike {
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
}

interface OperationArgs {
  args: unknown;
  query(args: unknown): Promise<unknown>;
}

export interface PrismaLike {
  $extends(ext: unknown): unknown;
  $transaction<R>(fn: (tx: TxLike) => Promise<R>): Promise<R>;
}

/** Wraps a Prisma client so every operation runs with the caller's claims. */
export function withRls<T extends PrismaLike>(prisma: T, claims: RlsClaims): T {
  const serialized = JSON.stringify(claims);
  return prisma.$extends({
    query: {
      $allOperations: ({ args, query }: OperationArgs) =>
        prisma.$transaction(async (tx: TxLike) => {
          await tx.$executeRawUnsafe(
            "select set_config('request.jwt.claims', $1, true)",
            serialized,
          );
          return query(args);
        }),
    },
  }) as T;
}
