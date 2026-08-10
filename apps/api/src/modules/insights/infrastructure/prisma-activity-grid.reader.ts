import { localDay, type ActivityDay, type IsoDate } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type {
  ActivityGridReader,
  ActivityRows,
  DayRange,
} from "../application/activity-grid.port.js";

/**
 * The grid's read.
 *
 * A year of cells is 365 rows on the `(user_id, day)` primary key — one indexed range scan, which
 * is the whole reason FR-Q2 insists the grid reads the rollup and never raw sessions.
 */
@Injectable()
export class PrismaActivityGridReader implements ActivityGridReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  daysIn(userId: string, range: DayRange): Promise<ActivityRows> {
    return this.db.run(userId, async (tx) => {
      const rows = await tx.dailyActivity.findMany({
        where: { day: { gte: dateColumn(range.from), lte: dateColumn(range.to) } },
        select: { day: true, focusMinutes: true, rebuiltAt: true },
        orderBy: { day: "asc" },
      });

      return {
        days: rows.map((row): ActivityDay => ({
          day: toIsoDate(row.day),
          focusMinutes: row.focusMinutes,
        })),
        // The freshest row in the range, not the whole table: a grid of last March should report
        // when last March was last rebuilt, not that the job ran again this morning.
        rebuiltAt: rows.reduce<Date | null>(
          (latest, row) => (latest === null || row.rebuiltAt > latest ? row.rebuiltAt : latest),
          null,
        ),
      };
    });
  }
}

/**
 * An `IsoDate` as the value a `date` column compares against.
 *
 * Postgres `date` has no zone, and the driver hands one back as UTC midnight — so UTC midnight is
 * also the only value that round-trips into a comparison unchanged. Applying the user's offset here
 * would shift every boundary by a day for anyone west of Greenwich.
 */
function dateColumn(day: IsoDate): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The inverse of `dateColumn`, through the same function every other "day" in the product uses. */
function toIsoDate(column: Date): IsoDate {
  return localDay(column, "UTC");
}
