import {
  IsoDateSchema,
  PutWeeklyPlanSchema,
  type IsoDate,
  type PlanSubject,
  type PutWeeklyPlanInput,
} from "@mindforge/core";
import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import {
  GetPlanVsActual,
  GetWeeklyPlan,
  PutWeeklyPlan,
  type WeeklyPlanResult,
  type WeeklyPlanVsActual,
} from "../application/planning.use-cases.js";

/**
 * One allocation, in the shape the client sent it.
 *
 * Two nullable ids rather than the `{kind, id}` subject the domain uses, so a `GET` response can be
 * handed straight back to `PUT` without translation. The grid loads a week, the user drags an hour
 * across, and the whole set goes back — a response the client has to reshape first is a second place
 * for the two sides to disagree about what a week contains.
 */
export interface AllocationView {
  readonly missionId: string | null;
  readonly skillId: string | null;
  readonly plannedMinutes: number;
}

export interface WeeklyPlanView {
  /**
   * The **normalised** week, which may not be the date in the URL.
   *
   * Returned so the SPA can tell: a client that asked for a Wednesday gets that Wednesday's week, and
   * seeing the correction is how it knows to update the address bar rather than to keep asking.
   */
  readonly weekStart: IsoDate;
  /** Empty for a week nobody planned. Empty is a set; it is not an absence and it is not a 404. */
  readonly allocations: readonly AllocationView[];
  readonly plannedTotal: number;
}

/** Missions before skills. Never alphabetical — ordering an enum-ish value by name has bitten twice. */
const SUBJECT_KIND_RANK: Readonly<Record<PlanSubject["kind"], number>> = { mission: 0, skill: 1 };

export function toWeeklyPlanView(result: WeeklyPlanResult): WeeklyPlanView {
  const allocations = [...(result.plan?.allocations ?? [])].sort(
    (a, b) =>
      b.plannedMinutes - a.plannedMinutes ||
      SUBJECT_KIND_RANK[a.subject.kind] - SUBJECT_KIND_RANK[b.subject.kind] ||
      a.subject.id.localeCompare(b.subject.id),
  );

  return {
    weekStart: result.weekStart,
    allocations: allocations.map((allocation) => ({
      missionId: allocation.subject.kind === "mission" ? allocation.subject.id : null,
      skillId: allocation.subject.kind === "skill" ? allocation.subject.id : null,
      plannedMinutes: allocation.plannedMinutes,
    })),
    // Zero for an unplanned week, and that is not the forbidden zero: nothing was planned, which the
    // empty allocation list says out loud. The nulls that matter are in plan-vs-actual, where an
    // unplanned subject has no attainment at all rather than 0%.
    plannedTotal: result.plan?.plannedTotal ?? 0,
  };
}

/**
 * `/v1/plans` (§6). Thin by design: parse, delegate, map.
 *
 * `:weekStart` is validated as a date at the boundary and normalised in the use case. Without the
 * first, a malformed value reaches Postgres and comes back as a 500 from a cast error rather than the
 * 422 it is; without the second, "the week of the 5th" and "the week of the 7th" would be two
 * different weeks.
 */
@Controller("plans")
export class PlansController {
  constructor(
    private readonly readPlan: GetWeeklyPlan,
    private readonly writePlan: PutWeeklyPlan,
    private readonly planVsActual: GetPlanVsActual,
  ) {}

  @Get(":weekStart")
  async get(
    @CurrentUser() user: RequestContext,
    @Param("weekStart", zodPipe(IsoDateSchema)) weekStart: IsoDate,
  ): Promise<WeeklyPlanView> {
    return toWeeklyPlanView(await this.readPlan.execute(user.userId, weekStart, user.weekStartsOn));
  }

  /**
   * FR-F5. `PUT` because it replaces the whole week — see `PutWeeklyPlanSchema` for why the grid is
   * saved as one value rather than row by row.
   */
  @Put(":weekStart")
  async put(
    @CurrentUser() user: RequestContext,
    @Param("weekStart", zodPipe(IsoDateSchema)) weekStart: IsoDate,
    @Body(zodPipe(PutWeeklyPlanSchema)) body: PutWeeklyPlanInput,
  ): Promise<WeeklyPlanView> {
    return toWeeklyPlanView(
      await this.writePlan.execute(user.userId, weekStart, user.weekStartsOn, body),
    );
  }

  /**
   * Plan versus actual (FR-F5) — the core weekly insight.
   *
   * Returned as the use case computed it, with no view mapper, following `GET /friction/summary`:
   * every field is already a number, a string key, or an `IsoDate`, and there is no `Date` to
   * serialise. A mapper here would be a second definition of the same shape.
   */
  @Get(":weekStart/actual")
  actual(
    @CurrentUser() user: RequestContext,
    @Param("weekStart", zodPipe(IsoDateSchema)) weekStart: IsoDate,
  ): Promise<WeeklyPlanVsActual> {
    // The timezone comes from the profile, never from the client and never from the server's own
    // clock (§5.2). It decides where the seven days begin and end.
    return this.planVsActual.execute(user.userId, weekStart, user.weekStartsOn, user.timezone);
  }
}
