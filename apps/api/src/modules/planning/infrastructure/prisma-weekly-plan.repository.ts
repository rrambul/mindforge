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
      /**
       * Upsert on `(user_id, week_start)`, not on the id.
       *
       * It was the id, on the grounds that the compound unique cannot be addressed without naming
       * the user in the `where` — true, and not a reason: RLS answers the same question, and the row
       * it finds is one RLS would have shown anyway. What the id version could not survive is two
       * saves racing: both read no plan for the week, both mint a fresh id, and the loser hits the
       * unique index. P2002 is not a `DomainError`, so the problem filter renders it as a 500 — on a
       * grid whose Save button a user is entirely likely to press twice.
       *
       * `update: {}` because a plan row carries nothing but its week; the allocations below are the
       * whole content, and `updated_at` is maintained by Prisma.
       */
      /**
       * Raw `insert … on conflict`, because Prisma's `upsert` is not atomic here.
       *
       * It was an upsert on the id, which two concurrent saves cannot survive: both read no plan for
       * the week, both mint an id, and the loser hits the unique index on `(user_id, week_start)`.
       * P2002 is not a `DomainError`, so the problem filter renders it as a 500 — on a grid whose
       * Save button a user is entirely likely to press twice.
       *
       * Switching the upsert to the compound unique did not fix it: Prisma still performs a
       * find-then-write round trip for this model and raised the same P2002, which a test caught.
       * One statement leaves no window at all.
       *
       * `returning id` matters as much as the conflict clause. When another request won the insert,
       * the id this caller minted was never used — and writing the allocations below against it
       * would violate the foreign key, trading one 500 for a different one.
       */
      const inserted = await tx.$queryRawUnsafe<{ id: string }[]>(
        `insert into weekly_plans (id, user_id, week_start, created_at, updated_at)
         values ($1::uuid, $2::uuid, $3::date, now(), now())
         on conflict (user_id, week_start) do update set updated_at = now()
         returning id`,
        p.id,
        p.userId,
        p.weekStart,
      );
      const plan = inserted[0];
      // Unreachable: `on conflict … do update` always returns a row, and the insert is the only
      // statement that could have failed. Guarded because the alternative is a foreign-key error
      // below whose message says nothing about this line.
      /* v8 ignore next */
      if (plan === undefined)
        throw new Error(`weekly_plans upsert returned nothing for ${p.weekStart}`);

      // Delete-then-insert inside the transaction the callback already is. A diff would need to know
      // what was there, and the caller is replacing the set precisely because it does not — the same
      // shape as `setLinks` in the resources module, and what makes a removed row expressible at all.
      // `plan.id`, not `p.id`. In the racing case the caller's id was never used — the upsert found
      // a row another request had just inserted — and writing allocations against the id we minted
      // would violate the foreign key. Trading one 500 for a different one is not a fix.
      await tx.weeklyAllocation.deleteMany({ where: { planId: plan.id } });

      if (p.allocations.length === 0) return;

      await tx.weeklyAllocation.createMany({
        data: p.allocations.map((allocation) => ({
          // Written explicitly rather than left to the claim, so the policy's WITH CHECK half is
          // exercised on every insert.
          userId: p.userId,
          planId: plan.id,
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
