import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { AttributionTargetReader } from "../application/attribution-targets.port.js";

/** Runs under RLS, so "does not exist" and "not yours" are the same answer — the right one either way. */
@Injectable()
export class PrismaAttributionTargetReader implements AttributionTargetReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  exists(userId: string, kind: "skill" | "resource", id: string): Promise<boolean> {
    return this.db.run(userId, async (tx) => {
      const found =
        kind === "skill"
          ? await tx.skill.findUnique({ where: { id }, select: { id: true } })
          : await tx.resource.findUnique({ where: { id }, select: { id: true } });
      return found !== null;
    });
  }
}
