import {
  CompleteWeeklyReviewSchema,
  IsoDateSchema,
  type CompleteWeeklyReviewInput,
  type IsoDate,
} from "@mindforge/core";
import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import { CompleteWeeklyReview, ListWeeklyReviews } from "../application/planning.use-cases.js";
import type { WeeklyReview } from "../domain/weekly-review.js";

export interface WeeklyReviewView {
  readonly id: string;
  /** The normalised week, as everywhere in this module. An `IsoDate` stays a date on the wire. */
  readonly weekStart: IsoDate;
  /** When the ritual happened — not when it was last edited. See the repository. */
  readonly completedAt: string;
  readonly changedOneThing: string | null;
  readonly note: string | null;
}

export function toWeeklyReviewView(review: WeeklyReview): WeeklyReviewView {
  return {
    id: review.id,
    weekStart: review.weekStart,
    completedAt: review.completedAt.toISOString(),
    changedOneThing: review.changedOneThing,
    note: review.note,
  };
}

/**
 * `/v1/reviews/weekly` (§6) — FR-F6, the ritual.
 *
 * Its own controller rather than a second root on `PlansController`, because a review is not a plan:
 * §3.3 keys it on the week rather than on a plan id precisely so you can review a week you never
 * planned, which is legitimate and common — the actuals are there either way.
 */
@Controller("reviews/weekly")
export class WeeklyReviewsController {
  constructor(
    private readonly complete: CompleteWeeklyReview,
    private readonly list: ListWeeklyReviews,
  ) {}

  /**
   * Records the week's review, or revises it.
   *
   * `POST` and not `PUT` even though it upserts: §6's route table names it a POST, and the resource
   * being created is *the review*, whose identity the client does not mint. It stays 201 on a
   * revision for the same reason `POST /resources/capture` does when it returns a resource you
   * already had — the status describes the endpoint's contract, not which branch ran.
   */
  @Post(":weekStart")
  async completeReview(
    @CurrentUser() user: RequestContext,
    @Param("weekStart", zodPipe(IsoDateSchema)) weekStart: IsoDate,
    @Body(zodPipe(CompleteWeeklyReviewSchema)) body: CompleteWeeklyReviewInput,
  ): Promise<WeeklyReviewView> {
    return toWeeklyReviewView(
      await this.complete.execute(user.userId, weekStart, user.weekStartsOn, body),
    );
  }

  /** Newest week first. Wrapped in an object so it can grow a cursor without breaking clients. */
  @Get()
  async listReviews(@CurrentUser() user: RequestContext): Promise<{ reviews: WeeklyReviewView[] }> {
    const reviews = await this.list.execute(user.userId);
    return { reviews: reviews.map(toWeeklyReviewView) };
  }
}
