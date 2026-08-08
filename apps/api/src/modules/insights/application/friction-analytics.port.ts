import type { FrictionType } from "@mindforge/core";

export const FRICTION_ANALYTICS_READER = Symbol("FrictionAnalyticsReader");

export interface FrictionAnalyticsFilter {
  readonly since?: Date | undefined;
  /** Exclusive upper bound, so a closed week is genuinely closed. See `FrictionSummaryQuerySchema`. */
  readonly until?: Date | undefined;
  /**
   * Narrows to one mission's friction. Mission is reachable only through the session, so this
   * filter excludes every standalone tap by construction — the same behaviour `/friction/summary`
   * already has, and the reason the unattributed counts come back zero when it is set.
   */
  readonly missionId?: string | undefined;
}

/**
 * One (type × mission) cell of a grouped cross-tab.
 *
 * A cross-tab rather than two aggregates because both breakdowns have to be folded from the same
 * rows: two independent queries could disagree — a session written between them would appear in one
 * total and not the other — and a review screen whose "by type" and "by mission" columns sum
 * differently is one nobody trusts twice.
 */
export interface FrictionCell {
  readonly type: FrictionType;
  /** Null for friction with no mission behind it: a standalone tap, or a session with no mission. */
  readonly missionId: string | null;
  readonly missionTopic: string | null;
  readonly count: number;
  /** Summed rather than averaged in SQL, so the mean is taken once, over the whole type. */
  readonly intensitySum: number;
  /** How many of `count` were logged outside any session at all. */
  readonly standaloneCount: number;
}

export interface FrictionAnalyticsReader {
  crossTab(userId: string, filter: FrictionAnalyticsFilter): Promise<FrictionCell[]>;
}
