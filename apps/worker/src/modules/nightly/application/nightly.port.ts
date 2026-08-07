import type { IsoDate, NotificationPref, StallCandidate, WeekStart } from "@mindforge/core";

/**
 * Everything the nightly run needs from the outside world, in one port.
 *
 * One port rather than the four narrow ones the API's modules use, and the reason is different here:
 * in `apps/api` the narrow ports exist to stop one bounded context reaching into another's
 * repository. The worker has no bounded contexts — it is a cron with a database connection — and
 * four interfaces with one implementation each would be ceremony rather than protection. What this
 * *does* buy is the thing that matters for a job that runs at 3am: the whole run is testable against
 * an in-memory double, with no Postgres and no clock.
 */

export const NIGHTLY_GATEWAY = Symbol("NightlyGateway");

export interface NightlyProfile {
  readonly userId: string;
  /** Already coerced through `resolveTimeZone`, so it is a zone Intl accepts. */
  readonly timezone: string;
  readonly weekStartsOn: WeekStart;
}

export interface RaisedNotification {
  readonly userId: string;
  readonly kind: "weekly_review" | "stall";
  readonly dedupeKey: string;
  readonly payload: Record<string, unknown>;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
}

export interface NightlyGateway {
  /**
   * Every account. The worker bypasses RLS, so this is the one place a cross-user read is correct —
   * and every call it makes afterwards is scoped by the `userId` it got from here.
   */
  listProfiles(): Promise<readonly NightlyProfile[]>;

  /** Rebuild `daily_activity` for the trailing window. Idempotent; see packages/db/src/rollup.ts. */
  rollUp(
    userId: string,
    timezone: string,
    range: { readonly from: IsoDate; readonly to: IsoDate },
  ): Promise<{ readonly daysWritten: number }>;

  /** Active missions with the day of their most recent focus session, if any. */
  stallCandidates(userId: string, timezone: string): Promise<readonly StallCandidate[]>;

  /** For labelling the nudge. Missions the caller does not own are absent, not empty-stringed. */
  missionTopics(
    userId: string,
    missionIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;

  /** Stored rows merged over `defaultNotificationPrefs()`, so a user with none gets the defaults. */
  notificationPrefs(userId: string): Promise<readonly NotificationPref[]>;

  /**
   * Insert, skipping any whose `(user_id, dedupe_key)` already exists.
   *
   * Returns how many were actually new. Uniqueness in Postgres rather than a check-then-insert here
   * is what makes the job safe to run twice: two ticks racing cannot both win.
   */
  raise(notifications: readonly RaisedNotification[]): Promise<number>;
}
