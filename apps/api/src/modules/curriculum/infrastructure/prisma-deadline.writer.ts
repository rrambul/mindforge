import type { IsoDate } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { DeadlineWriter } from "../application/deadline.port.js";

@Injectable()
export class PrismaDeadlineWriter implements DeadlineWriter {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  async append(userId: string, trackId: string, dueOn: IsoDate): Promise<void> {
    await this.db.run(userId, (tx) =>
      tx.$executeRawUnsafe(
        // `::date` from the learner's own `YYYY-MM-DD`: a day, never an instant, so
        // nothing on the way in can move it across midnight (FR-U6).
        `insert into module_deadlines (user_id, track_id, due_on)
         values ($1::uuid, $2::uuid, $3::date)`,
        userId,
        trackId,
        dueOn,
      ),
    );
  }
}
