import { Module } from "@nestjs/common";
import { ACTUAL_MINUTES } from "../application/actual-minutes.port.js";
import { PLAN_SUBJECTS } from "../application/plan-subjects.port.js";
import {
  CompleteWeeklyReview,
  GetPlanVsActual,
  GetWeeklyPlan,
  ListWeeklyReviews,
  PutWeeklyPlan,
} from "../application/planning.use-cases.js";
import { WEEKLY_PLAN_REPOSITORY } from "../domain/weekly-plan.repository.js";
import { WEEKLY_REVIEW_REPOSITORY } from "../domain/weekly-review.repository.js";
import { PrismaActualMinutesReader } from "../infrastructure/prisma-actual-minutes.reader.js";
import { PrismaPlanSubjectReader } from "../infrastructure/prisma-plan-subject.reader.js";
import { PrismaWeeklyPlanRepository } from "../infrastructure/prisma-weekly-plan.repository.js";
import { PrismaWeeklyReviewRepository } from "../infrastructure/prisma-weekly-review.repository.js";
import { PlansController } from "./plans.controller.js";
import { WeeklyReviewsController } from "./weekly-reviews.controller.js";

/**
 * The weekly rhythm (FR-F5, FR-F6).
 *
 * Nothing is exported yet. The nudge that asks "have you planned this week?" is a notification
 * concern and reads its own state; when something outside this module needs a plan it should arrive
 * through a use case here rather than through a second reader of `weekly_plans`.
 */
@Module({
  controllers: [PlansController, WeeklyReviewsController],
  providers: [
    GetWeeklyPlan,
    PutWeeklyPlan,
    GetPlanVsActual,
    CompleteWeeklyReview,
    ListWeeklyReviews,
    { provide: WEEKLY_PLAN_REPOSITORY, useClass: PrismaWeeklyPlanRepository },
    { provide: WEEKLY_REVIEW_REPOSITORY, useClass: PrismaWeeklyReviewRepository },
    { provide: PLAN_SUBJECTS, useClass: PrismaPlanSubjectReader },
    { provide: ACTUAL_MINUTES, useClass: PrismaActualMinutesReader },
  ],
})
export class PlanningModule {}
