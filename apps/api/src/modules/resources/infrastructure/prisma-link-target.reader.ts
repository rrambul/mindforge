import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { LinkTargetReader } from "../application/link-targets.port.js";

/**
 * Runs under RLS, so "does not exist" and "belongs to someone else" are the same answer — which is the
 * one the caller wants: either way it is not something this user can link to.
 */
@Injectable()
export class PrismaLinkTargetReader implements LinkTargetReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  exists(userId: string, kind: "mission" | "skill", id: string): Promise<boolean> {
    return this.db.run(userId, async (tx) => {
      const found =
        kind === "mission"
          ? await tx.mission.findUnique({ where: { id }, select: { id: true } })
          : await tx.skill.findUnique({ where: { id }, select: { id: true } });
      return found !== null;
    });
  }
}
