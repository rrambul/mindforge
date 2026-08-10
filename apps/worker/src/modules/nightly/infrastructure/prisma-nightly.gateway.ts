import { resolveTimeZone, type Clock, type IsoDate, type WeekStart } from "@mindforge/core";
import { rebuildDailyActivity, type PrismaClient } from "@mindforge/db";
import { Inject, Injectable } from "@nestjs/common";
import { CLOCK } from "../../../shared/clock.js";
import { PRISMA } from "../../../shared/prisma.js";
import type { NightlyGateway, NightlyProfile } from "../application/nightly.port.js";

/**
 * The worker's database access.
 *
 * **Every query names its user explicitly.** This connection bypasses RLS entirely — that is what a
 * background job needs and it is also what makes CLAUDE.md's first non-negotiable load-bearing here
 * rather than decorative. `listProfiles` is the single sanctioned cross-user read, and everything
 * downstream is scoped by the id it returned.
 */
@Injectable()
export class PrismaNightlyGateway implements NightlyGateway {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listProfiles(): Promise<readonly NightlyProfile[]> {
    const rows = await this.prisma.profile.findMany({
      select: { id: true, timezone: true, weekStartsOn: true },
    });

    return rows.map((row) => ({
      userId: row.id,
      // Coerced here rather than trusted. A zone Intl no longer knows would throw inside the
      // formatter and take down this user's whole run; falling back to UTC makes their grid wrong
      // until they fix the setting, which is a far better failure.
      timezone: resolveTimeZone(row.timezone),
      weekStartsOn: (row.weekStartsOn === 0 ? 0 : 1) satisfies WeekStart,
    }));
  }

  async rollUp(
    userId: string,
    timezone: string,
    range: { readonly from: IsoDate; readonly to: IsoDate },
  ): Promise<{ readonly daysWritten: number }> {
    return rebuildDailyActivity(this.prisma, userId, timezone, range, this.clock.now());
  }
}
