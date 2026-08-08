import type { IsoDate } from "@mindforge/core";
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
      /**
       * A real upsert on the compound unique, not a read followed by a write.
       *
       * This was `findFirst` then `create`, which loses the race a double-tap on "Complete review"
       * creates: both callers see nothing, both insert, and the loser raises P2002 — not a
       * `DomainError`, so the problem filter turns it into a 500 on the endpoint documented as
       * idempotent. A queue replay does the same thing without anyone tapping twice.
       *
       * Naming `userId` in the `where` is the part that looked wrong and is not: RLS answers the same
       * question, but a compound unique has to be addressed by both of its columns, and the row this
       * finds is one RLS would have shown anyway. `create` still carries it too.
       *
       * Prisma's `upsert` is enough here and was **not** enough for `weekly_plans`, which uses raw
       * `on conflict` instead — the difference is that this write is the whole operation, while a plan
       * save follows its upsert with allocation writes keyed on the row's id. If a concurrency test
       * ever catches a P2002 on this table, make it raw for the same reason.
       */
      const row = await tx.weeklyReview.upsert({
        where: { userId_weekStart: { userId, weekStart } },
        create: {
          id: review.id,
          userId: review.userId,
          weekStart,
          completedAt: review.completedAt,
          changedOneThing: review.changedOneThing,
          note: review.note,
        },
        // `completedAt` is deliberately absent. It records when the ritual happened, and a revision
        // on Wednesday must not restamp Sunday's review as Wednesday's — M2's finish line counts
        // reviews, and a cadence read off a column that moves is not a cadence.
        update: { changedOneThing: review.changedOneThing, note: review.note },
        select: COLUMNS,
      });

      return toReview(row);
    });
  }

  findForWeek(userId: string, weekStart: IsoDate): Promise<WeeklyReview | null> {
    return this.db.run(userId, async (tx) => {
      const row = await tx.weeklyReview.findFirst({
        where: { weekStart: toDateColumn(weekStart) },
        select: COLUMNS,
      });
      return row === null ? null : toReview(row);
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
