import type { IsoDate, WeekStart } from "@mindforge/core";

/**
 * Everything the nightly run needs from the outside world, in one port.
 *
 * One port rather than narrow ones, and the reason is different here than in
 * `apps/api`: there the narrow ports exist to stop one bounded context reaching
 * into another's repository. The worker has no bounded contexts — it is a cron
 * with a database connection — and several interfaces with one implementation
 * each would be ceremony rather than protection. What this *does* buy is the
 * thing that matters for a job that runs at 3am: the whole run is testable
 * against an in-memory double, with no Postgres and no clock.
 */

export const NIGHTLY_GATEWAY = Symbol("NightlyGateway");

export interface NightlyProfile {
  readonly userId: string;
  /** Already coerced through `resolveTimeZone`, so it is a zone Intl accepts. */
  readonly timezone: string;
  readonly weekStartsOn: WeekStart;
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
}
