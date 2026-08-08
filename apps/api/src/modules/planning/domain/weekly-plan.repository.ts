import type { IsoDate } from "@mindforge/core";
import type { WeeklyPlan } from "./weekly-plan.js";

export const WEEKLY_PLAN_REPOSITORY = Symbol("WeeklyPlanRepository");

/**
 * `userId` first on every method — CLAUDE.md's first non-negotiable in the type system. See
 * missions/domain/mission.repository.ts for why RLS is not enough on its own.
 */
export interface WeeklyPlanRepository {
  /**
   * The plan for a week, or null when the week was never planned.
   *
   * Null rather than an empty plan: "you have not planned this week" is a fact the caller needs to be
   * able to tell from "you planned nothing", and only one of the two has a row to replace.
   */
  findByWeek(userId: string, weekStart: IsoDate): Promise<WeeklyPlan | null>;

  /**
   * Writes the plan and its whole allocation set in one transaction.
   *
   * Upsert, and a replacement rather than a diff, for the reason `PutWeeklyPlanSchema` gives: the
   * grid is edited as a grid. One transaction is what makes "you removed that row" and "you added
   * this one" a single event — a half-applied set would be a week that was never intended.
   */
  replace(userId: string, plan: WeeklyPlan): Promise<void>;
}
