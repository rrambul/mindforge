import type { SpendTally } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { SpendReader } from "../application/spend.port.js";

interface Row {
  /** `numeric` comes back as a string; see `total` below. */
  total: string | null;
  priced: bigint;
  unpriced: bigint;
}

/**
 * `llm_calls`, summed over one window.
 *
 * **Summed in Postgres, not in JavaScript.** `cost_usd` is `numeric(10, 6)`, and
 * pulling a day's rows back to add them as floats is the money bug CLAUDE.md's
 * "cost as numeric, never float" exists to prevent — a hundred calls at
 * $0.000001 apiece is exactly where binary floating point starts lying. The
 * aggregate stays numeric all the way to the driver, which hands it over as a
 * string, and it is parsed once here.
 *
 * `count(*) filter (…)` rather than two queries: whether a call could be priced
 * and what the priced ones cost are one question about one set of rows, and asking
 * twice leaves room for the two answers to describe different sets.
 *
 * Through `UserScopedDb`, so RLS is the enforcement rather than the `where`
 * clause. The predicate is there too — a query that reads correctly on its own is
 * worth having — but the policy is what makes it safe.
 */
@Injectable()
export class PrismaSpendReader implements SpendReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  async inWindow(userId: string, from: Date, to: Date): Promise<SpendTally> {
    const rows = await this.db.run(userId, (tx) =>
      tx.$queryRawUnsafe<Row[]>(
        // Half-open on purpose: the caller passes a local day's bounds, and a
        // closed upper bound counts a call made exactly at midnight on both days.
        `select
           sum(cost_usd) filter (where cost_usd is not null) as total,
           count(*) filter (where cost_usd is not null) as priced,
           count(*) filter (where cost_usd is null) as unpriced
         from llm_calls
        where user_id = $1::uuid
          and created_at >= $2
          and created_at < $3`,
        userId,
        from,
        to,
      ),
    );

    const row = rows[0];
    // An aggregate over no rows still returns one row, with a null sum — so this
    // is the "the query went wrong" branch rather than the "nothing spent" one.
    if (!row) return { usd: 0, pricedCalls: 0, unpricedCalls: 0 };

    return {
      // `sum()` over zero matching rows is null, which here genuinely means zero:
      // there were no priced calls, so nothing priced was spent. That is measured,
      // unlike a null `cost_usd` on a call that did happen — which is why the two
      // are counted separately rather than collapsed.
      usd: row.total === null ? 0 : Number(row.total),
      pricedCalls: Number(row.priced),
      unpricedCalls: Number(row.unpriced),
    };
  }
}
