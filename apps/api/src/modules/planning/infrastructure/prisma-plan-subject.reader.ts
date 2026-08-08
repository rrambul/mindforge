import type { PlanSubject } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { PlanSubjectDetail, PlanSubjectReader } from "../application/plan-subjects.port.js";
import { subjectKey } from "../domain/plan-subject.js";

/**
 * Who the missions and skills a week names actually are.
 *
 * Runs under RLS, so a subject that is not this user's is simply absent from the result — "there is
 * no such mission" and "that mission is someone else's" are the same answer, and the caller turns
 * either into a 404.
 *
 * Two queries for any number of subjects. The planning grid and the review screen both ask about
 * every row on the page at once, and a query per row would turn one screen into twenty round trips.
 */
@Injectable()
export class PrismaPlanSubjectReader implements PlanSubjectReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  async read(
    userId: string,
    subjects: readonly PlanSubject[],
  ): Promise<Readonly<Record<string, PlanSubjectDetail>>> {
    const missionIds = idsOf(subjects, "mission");
    const skillIds = idsOf(subjects, "skill");
    if (missionIds.length === 0 && skillIds.length === 0) return {};

    return this.db.run(userId, async (tx) => {
      // Sequential rather than `Promise.all`: an interactive transaction is one connection, so
      // parallel queries on it queue anyway and only make the failure harder to read.
      const missions =
        missionIds.length === 0
          ? []
          : await tx.mission.findMany({
              where: { id: { in: missionIds } },
              select: { id: true, topic: true, status: true },
            });

      const skills =
        skillIds.length === 0
          ? []
          : await tx.skill.findMany({
              where: { id: { in: skillIds } },
              select: { id: true, name: true },
            });

      const details: Record<string, PlanSubjectDetail> = {};

      for (const mission of missions) {
        details[subjectKey({ kind: "mission", id: mission.id })] = {
          label: mission.topic,
          // Compared here rather than narrowed to `MissionStatus` first: this reader needs one bit,
          // and a status the app no longer knows is not parked — which is the safe reading, since
          // the alternative would silently hide a mission from planning.
          parked: mission.status === "parked",
        };
      }

      for (const skill of skills) {
        // A skill has no status and cannot be parked. False rather than "unknown": there is no state
        // this could be in that would make it true.
        details[subjectKey({ kind: "skill", id: skill.id })] = { label: skill.name, parked: false };
      }

      return details;
    });
  }
}

/** Deduplicated: the same subject asked about twice is one row to fetch. */
function idsOf(subjects: readonly PlanSubject[], kind: PlanSubject["kind"]): string[] {
  return [...new Set(subjects.filter((s) => s.kind === kind).map((s) => s.id))];
}
