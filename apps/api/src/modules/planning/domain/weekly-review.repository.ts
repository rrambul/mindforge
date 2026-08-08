import type { IsoDate } from "@mindforge/core";
import type { WeeklyReview } from "./weekly-review.js";

export const WEEKLY_REVIEW_REPOSITORY = Symbol("WeeklyReviewRepository");

export interface WeeklyReviewRepository {
  /**
   * Upsert on `(userId, weekStart)`, returning what is now stored.
   *
   * Idempotent rather than conflicting, because the review screen is somewhere you *revise* what you
   * decided — sitting on Wednesday realising the one thing you changed was the wrong one is the
   * feature working, and a 409 would make the honest correction the harder path.
   *
   * It returns the stored row rather than void because the two are not the same: `completedAt` is
   * kept from the first submission (see the adapter), so the review handed back to the client after a
   * revision carries the moment the ritual actually happened.
   */
  save(userId: string, review: WeeklyReview): Promise<WeeklyReview>;

  /**
   * The review for one week, if it has been done.
   *
   * The screen that shows a week needs exactly this, and asking the capped list instead was a data
   * loss: the SPA found `existing` by scanning the newest 52, so opening an older week rendered a
   * blank form labelled "Complete" — and submitting it overwrote the stored sentence through an
   * endpoint that is idempotent by design. The column M2's finish line is written in.
   */
  findForWeek(userId: string, weekStart: IsoDate): Promise<WeeklyReview | null>;

  /** Newest week first, capped by the caller. */
  list(userId: string, limit: number): Promise<WeeklyReview[]>;
}
