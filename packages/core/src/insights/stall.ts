/**
 * Mission stall detection (FR-N3, §10's `notify:stall-detection`).
 *
 * "No session on this mission in 12 days. Still active, or park it?" — the nudge exists to make
 * parking easy, not to shame you into working. Parking is a first-class state in this product
 * (FR-M4b), and the failure it prevents is a mission that stays nominally active while its goals
 * quietly miss their dates and its skills decay unwatched.
 *
 * Two definitions the docs leave open, settled here:
 *
 * - **"Untouched" means no focus session.** Not "no write": editing a mission's `why` at midnight is
 *   thinking about it, not working on it, and counting that would silence the one nudge that
 *   catches the mission you keep meaning to get back to.
 * - **A mission never touched at all counts from the day it was created.** Otherwise the missions
 *   most in need of the question — started with enthusiasm, never opened again — are the only ones
 *   that never trigger it.
 *
 * Parked, completed, and abandoned missions are excluded by the caller: this module is given
 * candidates, and "should this still be active?" is not a question to ask about a mission that
 * already answered it.
 */

import { calendarDaysBetween, type IsoDate } from "../time/calendar.js";

/** FR-N3's own example. Configurable per user through `notification_prefs.config`. */
export const STALL_AFTER_DAYS = 12;

export interface StallCandidate {
  readonly missionId: string;
  readonly createdOn: IsoDate;
  /** The most recent day a focus session ran against it. Null when there has never been one. */
  readonly lastSessionOn: IsoDate | null;
}

export interface Stall {
  readonly missionId: string;
  readonly untouchedDays: number;
  readonly lastSessionOn: IsoDate | null;
  /**
   * Stable per occurrence, so the nightly job can insert it against `notifications.dedupe_key` and
   * let Postgres decide whether it is new. Keyed on the week rather than the day: a mission that has
   * been quiet for a month should ask once a week, not thirty times.
   */
  readonly dedupeKey: string;
}

export interface StallOptions {
  readonly today: IsoDate;
  readonly afterDays?: number;
}

export function detectStalls(
  candidates: Iterable<StallCandidate>,
  options: StallOptions,
): readonly Stall[] {
  const afterDays = options.afterDays ?? STALL_AFTER_DAYS;
  const stalls: Stall[] = [];

  for (const candidate of candidates) {
    const since = candidate.lastSessionOn ?? candidate.createdOn;
    const untouchedDays = calendarDaysBetween(since, options.today);
    // Negative when a session is dated in the future — backfill lets that happen, and a mission
    // worked on tomorrow is not stalled today.
    if (untouchedDays < afterDays) continue;

    stalls.push({
      missionId: candidate.missionId,
      untouchedDays,
      lastSessionOn: candidate.lastSessionOn,
      dedupeKey: `stall:${candidate.missionId}:${weekBucket(options.today)}`,
    });
  }

  return stalls.sort(
    (a, b) => b.untouchedDays - a.untouchedDays || a.missionId.localeCompare(b.missionId),
  );
}

/**
 * The Monday nearest below `today`, as a bucket number.
 *
 * Anchored to a fixed Monday rather than to the user's own `weekStartsOn`: this is only a rate
 * limit, and tying it to a preference the user can change would let flipping that preference
 * re-raise every nudge they had already dismissed. Anchored to a *Monday* rather than to the epoch
 * because the epoch was a Thursday, and a nudge budget that resets mid-week is a detail somebody
 * would otherwise have to rediscover from the numbers.
 */
const FIRST_MONDAY: IsoDate = "1970-01-05";

function weekBucket(today: IsoDate): number {
  return Math.floor(calendarDaysBetween(FIRST_MONDAY, today) / 7);
}
