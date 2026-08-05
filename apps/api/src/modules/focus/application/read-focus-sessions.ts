import type { ListFocusSessionsQuery } from "@mindforge/core";
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

/**
 * Sessions are the one M1 list that genuinely grows without bound — ten a week for a year is
 * five hundred rows — so unlike missions this one is capped. A cursor comes with the insights
 * screens (§6.1) that actually page through history; for now the Today screen wants "recent",
 * and a hard ceiling is the honest way to say that.
 */
const DEFAULT_LIMIT = 50;

@Injectable()
export class ListFocusSessions {
  constructor(
    @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepository,
  ) {}

  execute(userId: string, query: ListFocusSessionsQuery): Promise<FocusSession[]> {
    return this.sessions.list(userId, { ...query, limit: DEFAULT_LIMIT });
  }
}
