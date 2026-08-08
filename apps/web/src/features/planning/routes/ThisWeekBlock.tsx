import { dayBounds, resolveTimeZone, type IsoDate } from "@mindforge/core";
import type { ReactNode } from "react";
import { usePlanVsActual } from "../api/use-planning.js";
import { useFrictionSplitSince } from "../api/use-week-friction.js";
import { ThisWeek } from "../ui/ThisWeek.js";

/**
 * Today's `THIS WEEK` block, wired to its two queries (§5.3).
 *
 * A route-level component rather than a fetching `ui/` one, because §2.2 rule 5 is what makes
 * `ThisWeek` testable with nothing but props. `TodayScreen` renders this — from `app/`, since
 * `focus` and `planning` are siblings and may not import each other.
 *
 * **It renders nothing until the week's numbers are known.** Today's budget is ≤5s to a started
 * session (§7.1) and its first pixel is information, so a placeholder here would be a spinner in
 * the middle of the one screen that must not have one. The block appearing a moment later costs
 * nothing; a skeleton that resolves to "no data" costs attention every single morning.
 */
export interface ThisWeekBlockProps {
  /** The current week, normalised by the app layer from the profile's `weekStartsOn`. */
  readonly weekStart: IsoDate;
  /** IANA, from the profile. Decides when the week's friction window opens. */
  readonly timeZone: string;
  /** A link to the week itself. The feature cannot know the route tree; `app/` supplies it. */
  readonly link?: ReactNode;
}

export function ThisWeekBlock({ weekStart, timeZone, link }: ThisWeekBlockProps) {
  const actual = usePlanVsActual(weekStart);
  const split = useFrictionSplitSince(
    dayBounds(weekStart, resolveTimeZone(timeZone)).start.toISOString(),
  );

  if (!actual.isSuccess) return null;

  return (
    <ThisWeek
      plannedMinutes={actual.data.plannedTotal}
      actualMinutes={actual.data.actualTotal}
      attainment={actual.data.attainment}
      split={split.data}
      link={link}
    />
  );
}
