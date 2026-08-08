/**
 * "Your last four weeks average 3.2 active days. Your weekly plans assume 5." (§3.9)
 *
 * **Nothing in the schema stores the second number.** `weekly_allocations` is minutes against a
 * mission or a skill, with no day dimension anywhere — §3.9 gives the sentence as an example and
 * the M2 schema simply cannot answer the half of it that is about days. So it is derived, and the
 * derivation is written down here rather than living as a constant somewhere that would make the
 * line a guess dressed as a measurement.
 *
 * **The rule.** Planned minutes for the week, divided by the minutes of a typical day you actually
 * show up. If your plan asks for 300 minutes and a day you show up is usually 75, the plan assumes
 * four days. Both numbers are yours: one is what you wrote down, the other is what you do.
 *
 * **Why the divisor is the median *day*, not the median session.** The obvious divisor is session
 * length, and it answers the wrong question — it yields sessions per week, and the other half of
 * §3.9's sentence counts *days*. Two people with identical plans and identical hours would then get
 * different signals purely because one of them splits an evening into two sittings, which is a fact
 * about their timer habits and not about their pace. Focus minutes per active day is already what
 * `daily_activity` stores, so the divisor also needs no second query.
 *
 * **Median rather than mean**, because a single six-hour Saturday should not raise the bar the rest
 * of the month is measured against.
 *
 * **It returns null often, and that is the design.** No plan, a plan that allocates nothing, or too
 * few active days to have a typical day at all — each returns null and the signal is simply absent.
 * `buildGrid` draws no line when it is null, which is the right outcome: §5.3's rule for a derived
 * line is that a manufactured one teaches you to stop reading them.
 */

/** Four whole weeks, matching `activeDaysIn28` and `backlogHealth` so the figures describe one span. */
export const PACE_WINDOW_DAYS = 28;

/**
 * One active day a week, over four weeks, before we claim to know what your day looks like.
 *
 * Below that the "median" is one or two numbers wearing a statistic's name, and the sentence it
 * produces would be confident about a pace we have barely observed.
 */
export const MIN_ACTIVE_DAYS_FOR_MEDIAN = 4;

/** A week has seven days. See the cap in `plannedDaysPerWeek`. */
export const MAX_PLANNED_DAYS_PER_WEEK = 7;

/**
 * @param plannedMinutes total allocated minutes of the plan in force, or null when there is none
 * @param dayMinutes focus minutes for every day in the pace window, empty days included
 */
export function plannedDaysPerWeek(
  plannedMinutes: number | null,
  dayMinutes: readonly number[],
): number | null {
  if (plannedMinutes === null || plannedMinutes <= 0) return null;

  // Empty days are dropped rather than counted as zero: the divisor is "what a day you show up
  // looks like", and rest days are part of the design (§3.9), not evidence of a shorter day.
  const active = dayMinutes.filter((minutes) => minutes > 0);
  if (active.length < MIN_ACTIVE_DAYS_FOR_MEDIAN) return null;

  const days = Math.round(plannedMinutes / median(active));

  // A plan smaller than one typical day implies fewer than one day a week, which the pace signal
  // has no way to say. Null rather than 0, so it is absent rather than a claim.
  if (days < 1) return null;

  // Days per week is bounded by seven by construction. A derivation above it means the plan needs
  // more than daily attendance at your usual pace — true, and not something this signal can phrase,
  // so seven is the strongest statement it can carry. The comparison still fires, which is right.
  return Math.min(days, MAX_PLANNED_DAYS_PER_WEEK);
}

/** Non-empty by the guard above, and every value positive, so the result is always > 0. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
