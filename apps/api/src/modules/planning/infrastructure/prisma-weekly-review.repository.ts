import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { WeeklyReview } from "../domain/weekly-review.js";
import type { WeeklyReviewRepository } from "../domain/weekly-review.repository.js";
import { fromDateColumn, toDateColumn } from "./date-column.js";

interface ReviewRow {
  id: string;
  userId: string;
  weekStart: Date;
  completedAt: Date;
  changedOneThing: string | null;
  note: string | null;
}

const COLUMNS = {
  id: true,
  userId: true,
  weekStart: true,
  completedAt: true,
  changedOneThing: true,
  note: true,
} as const;

@Injectable()
export class PrismaWeeklyReviewRepository implements WeeklyReviewRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  save(userId: string, review: WeeklyReview): Promise<WeeklyReview> {
    const weekStart = toDateColumn(review.weekStart);

    return this.db.run(userId, async (tx) => {
      // Read first, then write by id. Prisma's upsert would need the compound unique in its `where`,
      // which means naming the user in a predicate RLS already answers — see the plan repository.
      const existing = await tx.weeklyReview.findFirst({ where: { weekStart }, select: COLUMNS });

      const row = existing
        ? await tx.weeklyReview.update({
            where: { id: existing.id },
            // `completedAt` is deliberately not updated. It records when the ritual happened, and a
            // revision on Wednesday must not restamp Sunday's review as Wednesday's — M2's finish
            // line counts reviews, and a cadence read off a column that moves is not a cadence.
            data: { changedOneThing: review.changedOneThing, note: review.note },
            select: COLUMNS,
          })
        : await tx.weeklyReview.create({
            data: {
              id: review.id,
              userId: review.userId,
              weekStart,
              completedAt: review.completedAt,
              changedOneThing: review.changedOneThing,
              note: review.note,
            },
            select: COLUMNS,
          });

      return toReview(row);
    });
  }

  list(userId: string, limit: number): Promise<WeeklyReview[]> {
    return this.db.run(userId, async (tx) => {
      const rows = await tx.weeklyReview.findMany({
        // By week rather than by `completedAt`: the history is a list of *weeks*, and a review
        // written late would otherwise jump ahead of the weeks that came after it. A date column
        // sorts chronologically in SQL, so this is not the enum-ordering trap.
        orderBy: { weekStart: "desc" },
        take: limit,
        select: COLUMNS,
      });
      return rows.map(toReview);
    });
  }
}

function toReview(row: ReviewRow): WeeklyReview {
  return {
    id: row.id,
    userId: row.userId,
    weekStart: fromDateColumn(row.weekStart),
    completedAt: row.completedAt,
    changedOneThing: row.changedOneThing,
    note: row.note,
  };
}
