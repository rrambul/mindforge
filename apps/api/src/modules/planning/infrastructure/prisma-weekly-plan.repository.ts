import type { IsoDate } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { planSubjectFrom } from "../domain/plan-subject.js";
import { WeeklyPlan, type PlannedAllocation } from "../domain/weekly-plan.js";
import type { WeeklyPlanRepository } from "../domain/weekly-plan.repository.js";
import { fromDateColumn, toDateColumn } from "./date-column.js";

interface AllocationRow {
  missionId: string | null;
  skillId: string | null;
  plannedMinutes: number;
}

interface PlanRow {
  id: string;
  userId: string;
  weekStart: Date;
  allocations: AllocationRow[];
}

const COLUMNS = {
  id: true,
  userId: true,
  weekStart: true,
  allocations: { select: { missionId: true, skillId: true, plannedMinutes: true } },
} as const;

/**
 * Prisma lives here and nowhere else (§2.1).
 *
 * No `where: { userId }` below — the caller's RLS claims are in force for the whole transaction and
 * Postgres does the authorising. That is also why the week lookup is a `findFirst` rather than a
 * `findUnique` on `(user_id, week_start)`: reaching the compound unique means naming the user in the
 * predicate, and a hand-written filter beside a policy is the one that eventually gets forgotten.
 */
@Injectable()
export class PrismaWeeklyPlanRepository implements WeeklyPlanRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  findByWeek(userId: string, weekStart: IsoDate): Promise<WeeklyPlan | null> {
    return this.db.run(userId, async (tx) => {
      const row = await tx.weeklyPlan.findFirst({
        where: { weekStart: toDateColumn(weekStart) },
        select: COLUMNS,
      });
      return row ? toPlan(row) : null;
    });
  }

  async replace(userId: string, plan: WeeklyPlan): Promise<void> {
    const p = plan.toSnapshot();

    await this.db.run(userId, async (tx) => {
      // Upsert on the id rather than on `(user_id, week_start)`, for the reason above: the compound
      // unique cannot be used without putting the user in the `where`. The id is the one just read
      // for this week, or a fresh one when the week had no plan, so both branches land on one row.
      //
      // `update: {}` because a plan row carries nothing but its week — the allocations below are the
      // whole content, and `updated_at` is maintained by Prisma.
      await tx.weeklyPlan.upsert({
        where: { id: p.id },
        create: { id: p.id, userId: p.userId, weekStart: toDateColumn(p.weekStart) },
        update: {},
      });

      // Delete-then-insert inside the transaction the callback already is. A diff would need to know
      // what was there, and the caller is replacing the set precisely because it does not — the same
      // shape as `setLinks` in the resources module, and what makes a removed row expressible at all.
      await tx.weeklyAllocation.deleteMany({ where: { planId: p.id } });

      if (p.allocations.length === 0) return;

      await tx.weeklyAllocation.createMany({
        data: p.allocations.map((allocation) => ({
          // Written explicitly rather than left to the claim, so the policy's WITH CHECK half is
          // exercised on every insert.
          userId: p.userId,
          planId: p.id,
          missionId: allocation.subject.kind === "mission" ? allocation.subject.id : null,
          skillId: allocation.subject.kind === "skill" ? allocation.subject.id : null,
          plannedMinutes: allocation.plannedMinutes,
        })),
      });
    });
  }
}

function toPlan(row: PlanRow): WeeklyPlan {
  return WeeklyPlan.fromSnapshot({
    id: row.id,
    userId: row.userId,
    weekStart: fromDateColumn(row.weekStart),
    allocations: row.allocations.map(toAllocation),
  });
}

/**
 * The two nullable columns become one subject at the boundary where a row becomes a value.
 *
 * `planSubjectFrom` throws if a row somehow holds both or neither — which the check constraint makes
 * impossible, and which is exactly why a hand-edited row that broke it should be loud rather than
 * quietly attributed to whichever column was read first.
 */
function toAllocation(row: AllocationRow): PlannedAllocation {
  return {
    subject: planSubjectFrom(row.missionId, row.skillId),
    plannedMinutes: row.plannedMinutes,
  };
}
