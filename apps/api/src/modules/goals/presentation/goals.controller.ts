import {
  CloseGoalSchema,
  CreateGoalSchema,
  CreateGoalTargetSchema,
  goalStatusRank,
  ListGoalsQuerySchema,
  UpdateGoalSchema,
  UuidSchema,
  type CloseGoalInput,
  type CreateGoalInput,
  type CreateGoalTargetInput,
  type GoalStatus,
  type ListGoalsQuery,
  type TargetKind,
  type UpdateGoalInput,
} from "@mindforge/core";
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import {
  AddGoalTarget,
  CloseGoal,
  CreateGoal,
  EditGoal,
  GetGoal,
  ListGoals,
  RecomputeGoal,
  RemoveGoalTarget,
  ReopenGoal,
  SetManualTarget,
  type GoalWithProgress,
} from "../application/goal.use-cases.js";

const SetManualSchema = z.object({ satisfied: z.boolean() });

export interface TargetView {
  readonly id: string;
  readonly kind: TargetKind;
  readonly weight: number;
  /** 0..1, or null when it cannot be measured — never 0 standing in for absent data. */
  readonly fraction: number | null;
  readonly met: boolean;
  /** Which sort of unmeasurable, so the UI can say why rather than showing a shrug. */
  readonly unmeasurable: "no_data" | "not_yet_implemented" | null;
  readonly metAt: string | null;
  readonly resourceId: string | null;
  readonly skillId: string | null;
  readonly missionId: string | null;
  readonly target: Record<string, unknown>;
}

export interface GoalView {
  readonly id: string;
  readonly missionId: string | null;
  readonly title: string;
  readonly definitionOfDone: string | null;
  /** `YYYY-MM-DD`. A calendar day, not an instant — see the schema's note. */
  readonly targetDate: string | null;
  readonly status: GoalStatus;
  readonly outcomeNote: string | null;
  /** Null when nothing can be measured, which the client must render as a sentence, not as 0%. */
  readonly fraction: number | null;
  readonly targetCount: number;
  /** So the client can say "measuring 2 of 3 targets" rather than implying the number covers all. */
  readonly measuredWeight: number;
  readonly totalWeight: number;
  /** Every target met — the prompt to close it, never an automatic close. */
  readonly allTargetsMet: boolean;
  readonly targets: readonly TargetView[];
  readonly createdAt: string;
}

export function toGoalView({ goal, progress, evidence }: GoalWithProgress): GoalView {
  const snapshot = goal.toSnapshot();

  return {
    id: snapshot.id,
    missionId: snapshot.missionId,
    title: snapshot.title,
    definitionOfDone: snapshot.definitionOfDone,
    targetDate: snapshot.targetDate,
    status: snapshot.status,
    outcomeNote: snapshot.outcomeNote,
    fraction: progress.fraction,
    targetCount: progress.targetCount,
    measuredWeight: progress.measuredWeight,
    totalWeight: progress.totalWeight,
    allTargetsMet: progress.met,
    targets: goal.targets.map((target) => {
      const own = target.progressGiven(evidence[target.id] ?? {});
      const subject = target.subjectId;

      return {
        id: target.id,
        kind: target.kind,
        weight: target.weight,
        fraction: own.fraction,
        met: own.met,
        unmeasurable: own.unmeasurable,
        metAt: target.metAt?.toISOString() ?? null,
        resourceId: subject?.subject === "resource" ? subject.id : null,
        skillId: subject?.subject === "skill" ? subject.id : null,
        missionId: subject?.subject === "mission" ? subject.id : null,
        target: target.definition.target,
      };
    }),
    createdAt: snapshot.createdAt.toISOString(),
  };
}

/**
 * `/v1/goals` (FR-M3).
 *
 * There is no endpoint that accepts a progress value, and that absence is the feature. Every read
 * derives it from the targets; the only thing a client can set is a `manual` target's flag, which is a
 * checkbox rather than a number.
 */
@Controller("goals")
export class GoalsController {
  constructor(
    private readonly create: CreateGoal,
    private readonly edit: EditGoal,
    private readonly closeGoal: CloseGoal,
    private readonly reopen: ReopenGoal,
    private readonly addTarget: AddGoalTarget,
    private readonly removeTarget: RemoveGoalTarget,
    private readonly setManual: SetManualTarget,
    private readonly list: ListGoals,
    private readonly get: GetGoal,
    private readonly recompute: RecomputeGoal,
  ) {}

  @Get()
  async listGoals(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(ListGoalsQuerySchema)) query: ListGoalsQuery,
  ): Promise<{ goals: GoalView[] }> {
    const goals = await this.list.execute(user.userId, query);
    // Sorted here, not in SQL: `status` is a text column, so Postgres would order it alphabetically
    // and put `abandoned` first. Array#sort is stable, so recency survives within each status.
    const ordered = [...goals].sort(
      (a, b) => goalStatusRank(a.goal.status) - goalStatusRank(b.goal.status),
    );
    return { goals: ordered.map(toGoalView) };
  }

  @Get(":id")
  async getGoal(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<GoalView> {
    return toGoalView(await this.get.execute(user.userId, id));
  }

  @Post()
  async createGoal(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(CreateGoalSchema)) body: CreateGoalInput,
  ): Promise<GoalView> {
    const goal = await this.create.execute(user.userId, body);
    // Recomputed rather than returned bare: a target can be met the moment it is created — "read this
    // to 50%" on a book you have already finished — and reporting 0% would be wrong on the first
    // render, which is the render that decides whether the feature feels trustworthy.
    return toGoalView(await this.recompute.execute(user.userId, goal.id));
  }

  @Patch(":id")
  async updateGoal(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(UpdateGoalSchema)) body: UpdateGoalInput,
  ): Promise<GoalView> {
    await this.edit.execute(user.userId, id, body);
    return toGoalView(await this.get.execute(user.userId, id));
  }

  /** FR-M3: `missed` and `abandoned` are outcomes, not failures to hide. */
  @Post(":id/close")
  async close(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(CloseGoalSchema)) body: CloseGoalInput,
  ): Promise<GoalView> {
    await this.closeGoal.execute(user.userId, id, body);
    return toGoalView(await this.get.execute(user.userId, id));
  }

  @Post(":id/reopen")
  async reopenGoal(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<GoalView> {
    await this.reopen.execute(user.userId, id);
    return toGoalView(await this.get.execute(user.userId, id));
  }

  @Post(":id/targets")
  async addGoalTarget(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(CreateGoalTargetSchema)) body: CreateGoalTargetInput,
  ): Promise<GoalView> {
    await this.addTarget.execute(user.userId, id, body);
    return toGoalView(await this.recompute.execute(user.userId, id));
  }

  @Delete(":id/targets/:targetId")
  async deleteGoalTarget(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Param("targetId", zodPipe(UuidSchema)) targetId: string,
  ): Promise<GoalView> {
    await this.removeTarget.execute(user.userId, id, targetId);
    return toGoalView(await this.get.execute(user.userId, id));
  }

  /** The honest escape hatch (§3.8) — a checkbox, not a percentage. */
  @Patch(":id/targets/:targetId/manual")
  async setManualTarget(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Param("targetId", zodPipe(UuidSchema)) targetId: string,
    @Body(zodPipe(SetManualSchema)) body: { satisfied: boolean },
  ): Promise<GoalView> {
    await this.setManual.execute(user.userId, id, targetId, body.satisfied);
    return toGoalView(await this.get.execute(user.userId, id));
  }

  /**
   * Recompute on demand.
   *
   * Exists because a `skill_band` target moves through decay rather than through a write (FR-M3b), so
   * nothing else would ever mark it met. The nightly job calls the same use case.
   */
  @Post(":id/recompute")
  async recomputeGoal(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<GoalView> {
    return toGoalView(await this.recompute.execute(user.userId, id));
  }
}
