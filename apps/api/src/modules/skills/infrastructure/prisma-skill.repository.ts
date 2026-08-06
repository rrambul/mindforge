import type { PrereqEdge } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { Skill, type SkillSnapshot } from "../domain/skill.js";
import type { SkillFilter, SkillRepository } from "../domain/skill.repository.js";

interface SkillRow {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  perceivedLevel: unknown;
  score: unknown;
  scoreStdDev: unknown;
  halfLifeDays: unknown;
  lastEvidenceAt: Date | null;
  createdAt: Date;
}

const COLUMNS = {
  id: true,
  userId: true,
  name: true,
  slug: true,
  description: true,
  perceivedLevel: true,
  score: true,
  scoreStdDev: true,
  halfLifeDays: true,
  lastEvidenceAt: true,
  createdAt: true,
} as const;

@Injectable()
export class PrismaSkillRepository implements SkillRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  findById(userId: string, id: string): Promise<Skill | null> {
    return this.db.run(userId, async (tx) => {
      const row = await tx.skill.findUnique({ where: { id }, select: COLUMNS });
      return row ? toSkill(row) : null;
    });
  }

  findBySlug(userId: string, slug: string): Promise<Skill | null> {
    return this.db.run(userId, async (tx) => {
      // `findFirst` rather than the compound unique: RLS already scopes to this user, and naming
      // `userId` in the where clause would be reading ambient identity into a query that has it.
      const row = await tx.skill.findFirst({ where: { slug }, select: COLUMNS });
      return row ? toSkill(row) : null;
    });
  }

  list(userId: string, filter: SkillFilter): Promise<Skill[]> {
    return this.db.run(userId, async (tx) => {
      const rows = await tx.skill.findMany({
        // By name: the prerequisite ordering is applied in the application layer, and this is the
        // stable tiebreak within it. Sorting by score here would order by a stored value that decay
        // has since moved.
        orderBy: { name: "asc" },
        ...(filter.limit === undefined ? {} : { take: filter.limit }),
        select: COLUMNS,
      });
      return rows.map(toSkill);
    });
  }

  save(userId: string, skill: Skill): Promise<void> {
    const snapshot = skill.toSnapshot();

    return this.db.run(userId, async (tx) => {
      const data = {
        userId,
        name: snapshot.name,
        slug: snapshot.slug,
        description: snapshot.description,
        perceivedLevel: snapshot.perceivedLevel,
        halfLifeDays: snapshot.halfLifeDays,
        // `score`, `scoreStdDev`, and `lastEvidenceAt` are deliberately absent. They come from
        // evidence (FR-S2), and this write path is reachable from a self-rating — one line here would
        // be all it took to make a rating move the score and turn FR-S5's gap into a tautology.
      };

      await tx.skill.upsert({
        where: { id: snapshot.id },
        create: { id: snapshot.id, createdAt: snapshot.createdAt, ...data },
        update: data,
      });
    });
  }

  delete(userId: string, id: string): Promise<void> {
    return this.db.run(userId, async (tx) => {
      await tx.skill.deleteMany({ where: { id } });
    });
  }

  edges(userId: string): Promise<PrereqEdge[]> {
    return this.db.run(userId, async (tx) => {
      // Every edge, not one skill's: the cycle check needs the whole graph to see a transitive loop.
      const rows = await tx.skillEdge.findMany({ select: { skillId: true, prereqId: true } });
      return rows.map((row) => ({ skillId: row.skillId, prereqId: row.prereqId }));
    });
  }

  addEdge(userId: string, edge: PrereqEdge): Promise<void> {
    return this.db.run(userId, async (tx) => {
      // Idempotent: the primary key is (skill_id, prereq_id), so a repeated add is the same edge
      // rather than an error a client has to distinguish from a real conflict.
      await tx.skillEdge.upsert({
        where: { skillId_prereqId: { skillId: edge.skillId, prereqId: edge.prereqId } },
        create: { userId, skillId: edge.skillId, prereqId: edge.prereqId },
        update: {},
      });
    });
  }

  removeEdge(userId: string, edge: PrereqEdge): Promise<void> {
    return this.db.run(userId, async (tx) => {
      await tx.skillEdge.deleteMany({
        where: { skillId: edge.skillId, prereqId: edge.prereqId },
      });
    });
  }
}

function toSkill(row: SkillRow): Skill {
  const snapshot: SkillSnapshot = {
    id: row.id,
    userId: row.userId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    perceivedLevel: decimal(row.perceivedLevel),
    score: decimal(row.score),
    scoreStdDev: decimal(row.scoreStdDev),
    halfLifeDays: decimal(row.halfLifeDays) ?? 90,
    lastEvidenceAt: row.lastEvidenceAt,
    createdAt: row.createdAt,
  };
  return Skill.fromSnapshot(snapshot);
}

/**
 * A `numeric` column to a number.
 *
 * Prisma hands back a Decimal object for these, and `Number(null)` is 0 — which for `score` would turn
 * "unproven" into "scored zero", the exact conflation the null exists to prevent.
 */
function decimal(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}
