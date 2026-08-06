import {
  BANDS,
  GOAL_STATUSES,
  TargetDefinitionSchema,
  type Band,
  type TargetDefinition,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { GoalTarget } from "../domain/goal-target.js";
import { Goal, type GoalSnapshot } from "../domain/goal.js";
import type { GoalFilter, GoalRepository } from "../domain/goal.repository.js";

interface TargetRow {
  id: string;
  userId: string;
  goalId: string;
  kind: string;
  resourceId: string | null;
  skillId: string | null;
  missionId: string | null;
  target: unknown;
  weight: unknown;
  metAt: Date | null;
  bandAtStart: string | null;
}

interface GoalRow {
  id: string;
  userId: string;
  missionId: string | null;
  title: string;
  definitionOfDone: string | null;
  targetDate: Date | null;
  status: string;
  outcomeNote: string | null;
  createdAt: Date;
  targets: TargetRow[];
}

const TARGET_COLUMNS = {
  id: true,
  userId: true,
  goalId: true,
  kind: true,
  resourceId: true,
  skillId: true,
  missionId: true,
  target: true,
  weight: true,
  metAt: true,
  bandAtStart: true,
} as const;

const GOAL_COLUMNS = {
  id: true,
  userId: true,
  missionId: true,
  title: true,
  definitionOfDone: true,
  targetDate: true,
  status: true,
  outcomeNote: true,
  createdAt: true,
  targets: { select: TARGET_COLUMNS },
} as const;

@Injectable()
export class PrismaGoalRepository implements GoalRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  findById(userId: string, id: string): Promise<Goal | null> {
    return this.db.run(userId, async (tx) => {
      const row = await tx.goal.findUnique({ where: { id }, select: GOAL_COLUMNS });
      return row ? toGoal(row) : null;
    });
  }

  list(userId: string, filter: GoalFilter): Promise<Goal[]> {
    return this.db.run(userId, async (tx) => {
      const rows = await tx.goal.findMany({
        where: {
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.missionId ? { missionId: filter.missionId } : {}),
        },
        // Newest first within a status. The status ordering is applied in the presentation layer,
        // because `status` is a text column and Postgres would sort it alphabetically — putting
        // `abandoned` at the top, which is the trap missions and resources both fell into.
        orderBy: { createdAt: "desc" },
        ...(filter.limit === undefined ? {} : { take: filter.limit }),
        select: GOAL_COLUMNS,
      });
      return rows.map(toGoal);
    });
  }

  /**
   * The goal and every target, in one transaction.
   *
   * One unit of work because a goal saved without its targets reports progress over a subset — and
   * the number would look perfectly plausible, which is the worst kind of wrong for this product.
   */
  save(userId: string, goal: Goal): Promise<void> {
    const snapshot = goal.toSnapshot();

    return this.db.run(userId, async (tx) => {
      const data = {
        userId,
        missionId: snapshot.missionId,
        title: snapshot.title,
        definitionOfDone: snapshot.definitionOfDone,
        // A `date` column: parsed as UTC midnight so the day stored is the day the user typed,
        // regardless of where the server is.
        targetDate:
          snapshot.targetDate === null ? null : new Date(`${snapshot.targetDate}T00:00:00Z`),
        status: snapshot.status,
        outcomeNote: snapshot.outcomeNote,
      };

      await tx.goal.upsert({
        where: { id: snapshot.id },
        create: { id: snapshot.id, createdAt: snapshot.createdAt, ...data },
        update: data,
      });

      for (const target of goal.targets) {
        const t = target.toSnapshot();
        const { kind, ...parameters } = t.definition;
        const targetData = {
          userId,
          goalId: snapshot.id,
          kind,
          resourceId: subjectOf(t.definition, "resource"),
          skillId: subjectOf(t.definition, "skill"),
          missionId: subjectOf(t.definition, "mission"),
          target: parameters.target,
          weight: t.weight,
          metAt: t.metAt,
          bandAtStart: t.bandAtStart,
        };

        await tx.goalTarget.upsert({
          where: { id: t.id },
          create: { id: t.id, ...targetData },
          update: targetData,
        });
      }
    });
  }

  deleteTarget(userId: string, goalId: string, targetId: string): Promise<void> {
    return this.db.run(userId, async (tx) => {
      // Scoped by goal as well as id: a target id from another goal must not delete anything, even
      // though RLS already prevents reaching another user's.
      await tx.goalTarget.deleteMany({ where: { id: targetId, goalId } });
    });
  }

  saveTargetMetAt(userId: string, target: GoalTarget): Promise<void> {
    return this.db.run(userId, async (tx) => {
      // Only `met_at`. A recompute must not rewrite a definition — that is the difference between
      // observing a target and editing one.
      await tx.goalTarget.updateMany({
        where: { id: target.id },
        data: { metAt: target.metAt },
      });
    });
  }
}

/** Which id column a definition fills, so the three stay mutually exclusive. */
function subjectOf(
  definition: TargetDefinition,
  subject: "resource" | "skill" | "mission",
): string | null {
  if (subject === "resource" && definition.kind === "resource_progress") {
    return definition.resourceId;
  }
  if (
    subject === "skill" &&
    (definition.kind === "skill_band" || definition.kind === "review_accuracy")
  ) {
    return definition.skillId;
  }
  if (
    subject === "mission" &&
    (definition.kind === "focus_hours" || definition.kind === "lessons_completed")
  ) {
    return definition.missionId;
  }
  return null;
}

function toGoal(row: GoalRow): Goal {
  const snapshot: GoalSnapshot = {
    id: row.id,
    userId: row.userId,
    missionId: row.missionId,
    title: row.title,
    definitionOfDone: row.definitionOfDone,
    // Back to `YYYY-MM-DD`. The driver hands back a Date at UTC midnight for a `date` column, and
    // formatting it any other way would shift the day for anyone west of UTC.
    targetDate: row.targetDate === null ? null : row.targetDate.toISOString().slice(0, 10),
    status: narrow(row.status, GOAL_STATUSES, "goals.status"),
    outcomeNote: row.outcomeNote,
    createdAt: row.createdAt,
  };

  return Goal.fromSnapshot(snapshot, row.targets.map(toTarget));
}

function toTarget(row: TargetRow): GoalTarget {
  // Parsed rather than cast. The definition is spread across a text column, three nullable id
  // columns, and a JSON blob, so reassembling it is the one place a bad row can become a target that
  // silently measures nothing — and the schema is already the authority on what a valid one is.
  const definition = TargetDefinitionSchema.parse({
    kind: row.kind,
    ...(row.resourceId === null ? {} : { resourceId: row.resourceId }),
    ...(row.skillId === null ? {} : { skillId: row.skillId }),
    ...(row.missionId === null ? {} : { missionId: row.missionId }),
    target: row.target,
  });

  return GoalTarget.fromSnapshot({
    id: row.id,
    userId: row.userId,
    goalId: row.goalId,
    definition,
    weight: Number(row.weight),
    metAt: row.metAt,
    bandAtStart: row.bandAtStart === null ? null : narrow<Band>(row.bandAtStart, BANDS, "band"),
  });
}

/**
 * A text column into a union.
 *
 * Throws rather than defaulting: a status the app does not know is a migration that half-landed, and
 * quietly treating it as `active` would put a goal in a list it does not belong in.
 */
function narrow<T extends string>(value: string, allowed: readonly T[], column: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Unexpected ${column}: ${value}`);
}
