import { budgetStatus, dayBounds, localDay, type BudgetStatus } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";

import { ENV, type Env } from "../../../shared/config/env.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { SPEND_READER, type SpendReader } from "./spend.port.js";

export interface SpendView extends BudgetStatus {
  /** The learner's own day, so the UI can say which one it is measuring. */
  readonly day: string;
}

/**
 * Today's teaching spend, and whether another run is allowed (FR-T8).
 *
 * One use case with two callers, deliberately: the controller renders it and
 * `TeachRuns.request` enforces it. A second implementation of "is this learner
 * over budget" is how the meter and the refusal come to disagree, which would be
 * the worst possible version of this feature — a bar showing room left next to a
 * button that will not work.
 *
 * **The day is the learner's, not the server's.** Every day in this product
 * derives from their IANA timezone (§5.2), and a budget that reset at UTC midnight
 * would cut somebody's evening in half in Brazil and hand somebody in Auckland two
 * allowances on a Tuesday.
 */
@Injectable()
export class TeachSpend {
  constructor(
    @Inject(SPEND_READER) private readonly spend: SpendReader,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async today(userId: string, timezone: string): Promise<SpendView> {
    const now = this.clock.now();
    const day = localDay(now, timezone);
    const { start, end } = dayBounds(day, timezone);

    const tally = await this.spend.inWindow(userId, start, end);

    return {
      ...budgetStatus(tally, this.env.TEACH_DAILY_BUDGET_USD),
      day,
    };
  }
}
