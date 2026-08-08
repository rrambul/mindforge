import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { BacklogReader, BacklogRow } from "../application/backlog.port.js";

@Injectable()
export class PrismaBacklogReader implements BacklogReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  listWithLastTouch(userId: string): Promise<BacklogRow[]> {
    return this.db.run(userId, async (tx) => {
      const resources = await tx.resource.findMany({
        select: {
          id: true,
          status: true,
          addedAt: true,
          finishedAt: true,
          abandonReason: true,
        },
      });

      // One grouped max for the whole library, not one query per resource. A backlog of forty books
      // is forty round trips otherwise, on a screen that also draws a year of grid.
      //
      // Unbounded in time on purpose: this feeds "stalled" (§FR-I7), which counts back from today
      // with no window, and an item last touched fourteen months ago has to report that rather than
      // report never being touched at all — those are different facts and the UI says which.
      const touches = await tx.focusSession.groupBy({
        by: ["resourceId"],
        where: { resourceId: { not: null } },
        _max: { startedAt: true },
      });

      const lastTouch = new Map<string, Date>();
      for (const group of touches) {
        // `groupBy` cannot narrow the column's nullability from the `where` above, so both checks
        // are the type system catching up rather than cases that occur.
        if (group.resourceId === null || group._max.startedAt === null) continue;
        lastTouch.set(group.resourceId, group._max.startedAt);
      }

      return resources.map((resource): BacklogRow => ({
        id: resource.id,
        // Free text with no check constraint. Passed through rather than narrowed: `backlogHealth`
        // treats an unrecognised status as "not open", which is the safe reading, and throwing
        // here would take the whole dashboard down over one odd row.
        status: resource.status,
        addedAt: resource.addedAt,
        finishedAt: resource.finishedAt,
        abandonReason: resource.abandonReason,
        lastTouchedAt: lastTouch.get(resource.id) ?? null,
      }));
    });
  }
}
