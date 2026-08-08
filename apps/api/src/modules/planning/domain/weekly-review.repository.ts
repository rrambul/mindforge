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

  /** Newest week first, capped by the caller. */
  list(userId: string, limit: number): Promise<WeeklyReview[]>;
}
