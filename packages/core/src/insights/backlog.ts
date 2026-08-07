/**
 * Backlog health (FR-I7, FR-R6) and stall detection (FR-N3).
 *
 * **§9 does not define these.** It specifies four algorithms — skill score, FSRS, friction
 * classification, ZPD — and backlog is not among them. FR-I7 names the outputs ("queue growth vs.
 * throughput", "abandonment rate and reasons", "stalled items") with no window, no threshold, and no
 * definition of stalled. So this file is the definition, and every choice in it is written down
 * rather than left in the numbers.
 *
 * **The window is 28 days.** Four whole weeks, matching the activity grid's "active days in the last
 * 28" (§3.9) so the two figures beside each other describe the same span. Seven days is too noisy
 * for a queue measured in books; a calendar month drifts against the weekly rhythm the milestone is
 * about.
 *
 * **"Open" means you could still act on it**: inbox, queued, active. Finished and abandoned are
 * resolved; `reference` is neither — a reference resource is a thing you keep, not a thing you owe
 * yourself, and counting it as backlog would make a well-organised library look like debt.
 *
 * **"Stalled" means started and then dropped, without saying so.** Status `active` and no focus
 * session for `stalledAfterDays`. Abandoning is first-class and guilt-free in this product (FR-R5);
 * a stalled item is precisely the one you have *not* abandoned, and the useful action is to decide.
 * The default is 21 days rather than FR-N3's 12 for missions, because a resource can reasonably sit
 * untouched for a fortnight between reading sessions and a mission cannot.
 *
 * **Nothing here returns a grade.** Signals are returned as a key plus its numbers, never as a
 * sentence: the SPA translates (§5.2), and a growing queue is a fact rather than a failure.
 */

import { addDays, calendarDaysBetween, type IsoDate } from "../time/calendar.js";

/** Resource statuses that still represent an open loop. */
const OPEN_STATUSES: ReadonlySet<string> = new Set(["inbox", "queued", "active"]);

export const BACKLOG_WINDOW_DAYS = 28;
export const STALLED_AFTER_DAYS = 21;

/**
 * One resource, flattened. Dates rather than instants: the caller has already bucketed them into
 * the user's timezone, and a backlog measured in days has no business carrying an offset.
 */
export interface BacklogResource {
  readonly id: string;
  readonly status: string;
  readonly addedOn: IsoDate;
  /** The day it was finished or abandoned. Null while it is still open. */
  readonly resolvedOn: IsoDate | null;
  /** Present only on abandonment. The reason is prime friction data (FR-R5). */
  readonly abandonReason: string | null;
  /** The most recent day a focus session touched it, if any. */
  readonly lastTouchedOn: IsoDate | null;
}

export interface StalledResource {
  readonly id: string;
  readonly untouchedDays: number;
  /** Null when it has never been touched at all — different from "touched a long time ago". */
  readonly lastTouchedOn: IsoDate | null;
}

/**
 * A fact worth putting a sentence around, or null when there is not one.
 *
 * Null is the common case and the important one: §5.3's rule for the "one thing" block is that a
 * manufactured insight trains you to stop reading them. The keys are ICU message keys; the numbers
 * are its arguments.
 */
export type BacklogSignal =
  | { readonly kind: "growing"; readonly added: number; readonly resolved: number }
  | { readonly kind: "stalling"; readonly count: number; readonly days: number }
  | { readonly kind: "aging"; readonly days: number }
  | null;

export interface BacklogHealth {
  readonly windowDays: number;
  readonly added: number;
  /** Finished plus abandoned, within the window. */
  readonly resolved: number;
  /** added − resolved. Positive means the queue grew. */
  readonly netChange: number;
  readonly openCount: number;
  /** Age in days of the oldest open item. Null when nothing is open. */
  readonly oldestOpenDays: number | null;
  readonly medianOpenAgeDays: number | null;
  readonly stalled: readonly StalledResource[];
  readonly abandoned: number;
  readonly finished: number;
  /**
   * abandoned ÷ resolved, within the window. Null when nothing resolved.
   *
   * Reported without comment. A high abandonment rate can mean you are choosing badly or that you
   * have got good at cutting losses, and the product has no way to tell which.
   */
  readonly abandonmentRate: number | null;
  /** Descending by count, then by reason, so the same data never renders in two orders. */
  readonly abandonReasons: readonly { readonly reason: string; readonly count: number }[];
  readonly signal: BacklogSignal;
}

export interface BacklogOptions {
  readonly today: IsoDate;
  readonly windowDays?: number;
  readonly stalledAfterDays?: number;
}

export function backlogHealth(
  resources: Iterable<BacklogResource>,
  options: BacklogOptions,
): BacklogHealth {
  const windowDays = options.windowDays ?? BACKLOG_WINDOW_DAYS;
  const stalledAfterDays = options.stalledAfterDays ?? STALLED_AFTER_DAYS;
  const from = addDays(options.today, -(windowDays - 1));

  const inWindow = (day: IsoDate): boolean =>
    calendarDaysBetween(from, day) >= 0 && calendarDaysBetween(day, options.today) >= 0;

  let added = 0;
  let finished = 0;
  let abandoned = 0;
  const openAges: number[] = [];
  const stalled: StalledResource[] = [];
  const reasons = new Map<string, number>();

  for (const resource of resources) {
    if (inWindow(resource.addedOn)) added += 1;

    if (resource.resolvedOn !== null && inWindow(resource.resolvedOn)) {
      if (resource.abandonReason !== null) {
        abandoned += 1;
        reasons.set(resource.abandonReason, (reasons.get(resource.abandonReason) ?? 0) + 1);
      } else {
        finished += 1;
      }
    }

    if (!OPEN_STATUSES.has(resource.status)) continue;

    // Age counts from the day it was added, however long ago that was — an item that has sat in the
    // inbox for a year is the whole point of the figure, and clipping it to the window would hide
    // exactly the thing worth seeing.
    openAges.push(calendarDaysBetween(resource.addedOn, options.today));

    if (resource.status !== "active") continue;
    const since = resource.lastTouchedOn ?? resource.addedOn;
    const untouchedDays = calendarDaysBetween(since, options.today);
    if (untouchedDays >= stalledAfterDays) {
      stalled.push({
        id: resource.id,
        untouchedDays,
        lastTouchedOn: resource.lastTouchedOn,
      });
    }
  }

  stalled.sort((a, b) => b.untouchedDays - a.untouchedDays || a.id.localeCompare(b.id));

  const resolved = finished + abandoned;
  const openCount = openAges.length;

  const health = {
    windowDays,
    added,
    resolved,
    netChange: added - resolved,
    openCount,
    oldestOpenDays: openCount === 0 ? null : Math.max(...openAges),
    medianOpenAgeDays: median(openAges),
    stalled,
    abandoned,
    finished,
    abandonmentRate: resolved === 0 ? null : abandoned / resolved,
    abandonReasons: [...reasons]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };

  return { ...health, signal: signalFor(health, stalledAfterDays) };
}

/**
 * At most one signal, and only when it clears a bar.
 *
 * Ordered by what you can act on soonest rather than by size: deciding about four stalled books is
 * a smaller act than reversing a month of queue growth, and an insight nobody acts on is a diary
 * entry (FR-C4 makes the same argument about friction).
 */
function signalFor(health: Omit<BacklogHealth, "signal">, stalledAfterDays: number): BacklogSignal {
  if (health.stalled.length >= 3) {
    return { kind: "stalling", count: health.stalled.length, days: stalledAfterDays };
  }
  // Two clear of throughput, not one: a queue that grew by a single item in four weeks is noise,
  // and a line about it every month is how a user learns to stop reading the line.
  if (health.netChange >= 2 && health.added >= 3) {
    return { kind: "growing", added: health.added, resolved: health.resolved };
  }
  if (health.oldestOpenDays !== null && health.oldestOpenDays >= 180) {
    return { kind: "aging", days: health.oldestOpenDays };
  }
  return null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
