import type { FocusSession } from "./focus-session.js";

export const FOCUS_SESSION_REPOSITORY = Symbol("FocusSessionRepository");

export interface FocusSessionFilter {
  readonly missionId?: string | undefined;
  /** Inclusive lower bound on `startedAt`. */
  readonly since?: Date | undefined;
  readonly limit?: number | undefined;
}

/**
 * `userId` first on every method, always — CLAUDE.md's first non-negotiable expressed in the
 * type system. See missions/domain/mission.repository.ts for why RLS is not enough on its own.
 */
export interface FocusSessionRepository {
  findById(userId: string, id: string): Promise<FocusSession | null>;

  /**
   * The one open session, if there is one.
   *
   * A single query rather than a list, because "is something running" is the question the
   * Today screen asks on every load and the one the start rule turns on.
   */
  findRunning(userId: string): Promise<FocusSession | null>;

  list(userId: string, filter: FocusSessionFilter): Promise<FocusSession[]>;

  /**
   * Upsert, not insert.
   *
   * §6.1 makes the capture endpoints idempotent on a client-generated id so the offline
   * queue can replay them freely. That only works if writing the same session twice is a
   * no-op rather than a duplicate — which is why this is `save` and not `create`.
   */
  save(userId: string, session: FocusSession): Promise<void>;
}
