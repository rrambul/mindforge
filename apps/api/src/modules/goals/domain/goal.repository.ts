import type { GoalStatus } from "@mindforge/core";
import type { GoalTarget } from "./goal-target.js";
import type { Goal } from "./goal.js";

export const GOAL_REPOSITORY = Symbol("GoalRepository");

export interface GoalFilter {
  readonly status?: GoalStatus | undefined;
  readonly missionId?: string | undefined;
  readonly limit?: number | undefined;
}

export interface GoalRepository {
  /** Loaded with its targets: a goal without them cannot report progress, so there is no half-goal. */
  findById(userId: string, id: string): Promise<Goal | null>;
  list(userId: string, filter: GoalFilter): Promise<Goal[]>;
  /** Upsert of the goal and all its targets in one transaction. */
  save(userId: string, goal: Goal): Promise<void>;
  /** Targets removed from the aggregate, deleted in the same unit of work as `save`. */
  deleteTarget(userId: string, goalId: string, targetId: string): Promise<void>;
  saveTargetMetAt(userId: string, target: GoalTarget): Promise<void>;
}
