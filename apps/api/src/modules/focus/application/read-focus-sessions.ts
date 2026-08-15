import { decodeCursor, encodeCursor, type ListFocusSessionsQuery } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import type { FocusSession } from "../domain/focus-session.js";
import {
  FOCUS_SESSION_REPOSITORY,
  type FocusSessionRepository,
} from "../domain/focus-session.repository.js";

/**
 * The running session, or null.
 *
 * Its own query because the Today screen asks it on every load and needs the answer before
 * it can decide whether to show a timer or a Start button (§5.3). A list filtered client-side
 * would fetch history to answer a question about right now.
 */
@Injectable()
export class GetRunningFocusSession {
  constructor(
    @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepository,
  ) {}

  execute(userId: string): Promise<FocusSession | null> {
    return this.sessions.findRunning(userId);
  }
}

export interface FocusSessionPage {
  readonly sessions: readonly FocusSession[];
  /** Null on the last page. Opaque to the client — see `schemas/cursor.ts`. */
  readonly nextCursor: string | null;
}

/**
 * Sessions are the one list that genuinely grows without bound — ten a week for a year is
 * five hundred rows — and until now it was simply truncated at fifty.
 *
 * That comment used to say a cursor "comes with the insights screens (§6.1)"; it did not, and
 * the fifty-first session was unreachable: history that exists, is stored, and cannot be read.
 * `PaginationSchema` in `packages/core` had declared `cursor` since M1 with nobody issuing one.
 *
 * **One extra row decides whether there is a next page.** Asking for `limit + 1` and returning
 * `limit` is the only way to answer that without a second `count(*)` over the same predicate —
 * and a count would be a different query against a table that may have changed between the two.
 */
@Injectable()
export class ListFocusSessions {
  constructor(
    @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepository,
  ) {}

  async execute(userId: string, query: ListFocusSessionsQuery): Promise<FocusSessionPage> {
    // Null for a cursor this codec did not write — a bookmark, or one from a
    // previous release. Serving the first page beats a 500 over a stale URL.
    const after = decodeCursor(query.cursor) ?? undefined;

    const rows = await this.sessions.list(userId, {
      missionId: query.missionId,
      since: query.since,
      after,
      limit: query.limit + 1,
    });

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      sessions: page,
      // A cursor only when the extra row came back. Emitting one unconditionally
      // would give every client one guaranteed empty request at the end of the
      // list, which is the sort of thing that only shows up in an invoice.
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ startedAt: last.toSnapshot().startedAt, id: last.toSnapshot().id })
          : null,
    };
  }
}
