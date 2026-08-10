import { buildGrid, type ActivityGrid, type ActivityGridQuery } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import {
  ACTIVITY_GRID_READER,
  type ActivityGridReader,
  type DayRange,
} from "./activity-grid.port.js";

/**
 * The frequency tracker's read side (§6's `insights` module, FR-Q1).
 *
 * There is no `domain/` layer under this module, and that is the rule rather than an omission:
 * CLAUDE.md says to add layers when there is an invariant to protect, and nothing here writes
 * anything. The maths that *would* be domain logic already lives in `packages/core` — `buildGrid` —
 * because the SPA renders the same numbers and non-negotiable 3 forbids a second implementation.
 */

export interface ActivityGridResult {
  readonly grid: ActivityGrid;
  readonly rebuiltAt: Date | null;
}

@Injectable()
export class GetActivityGrid {
  constructor(@Inject(ACTIVITY_GRID_READER) private readonly activity: ActivityGridReader) {}

  async execute(userId: string, query: ActivityGridQuery): Promise<ActivityGridResult> {
    const range: DayRange = { from: query.from, to: query.to };
    const { days, rebuiltAt } = await this.activity.daysIn(userId, range);

    // No timezone conversion here: `daily_activity.day` is already a date in the user's timezone,
    // written that way by the rollup. Re-bucketing it would apply the offset twice.
    return { grid: buildGrid(days, range), rebuiltAt };
  }
}
