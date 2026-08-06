import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { SubjectExistenceReader } from "../application/subject-existence.port.js";

/**
 * Existence checks for a target's subject.
 *
 * Runs under RLS, so "does not exist" and "belongs to someone else" are the same answer — which is
 * the answer the caller wants: either way the target would point at something this user cannot see.
 */
@Injectable()
export class PrismaSubjectExistenceReader implements SubjectExistenceReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  exists(userId: string, subject: "resource" | "skill" | "mission", id: string): Promise<boolean> {
    return this.db.run(userId, async (tx) => {
      const found =
        subject === "resource"
          ? await tx.resource.findUnique({ where: { id }, select: { id: true } })
          : subject === "skill"
            ? await tx.skill.findUnique({ where: { id }, select: { id: true } })
            : await tx.mission.findUnique({ where: { id }, select: { id: true } });
      return found !== null;
    });
  }

  skillScore(userId: string, skillId: string): Promise<number | null> {
    return this.db.run(userId, async (tx) => {
      const skill = await tx.skill.findUnique({ where: { id: skillId }, select: { score: true } });
      // Null for a missing skill and null for an unscored one, which is correct: `bandFor` treats both
      // as unproven, and inventing a distinction here would be inventing data.
      return skill?.score === null || skill?.score === undefined ? null : Number(skill.score);
    });
  }
}
