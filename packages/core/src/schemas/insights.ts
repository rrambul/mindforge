import { z } from "zod";
import { calendarDaysBetween, isIsoDate } from "../time/calendar.js";
import { IsoDateSchema } from "./common.js";

/**
 * The frequency tracker's read-only query (FR-Q1, §6's `insights` module).
 *
 * The grid reads `daily_activity` and nothing else, so the query is only a
 * range. Intensity is focus minutes — the layer switcher went with the v0.2
 * refocus, and it returns only with a second data source worth drawing.
 */

/** A desktop year, and a little slack. Bounded so one request cannot ask for a decade. */
export const MAX_GRID_DAYS = 400;

// The range refinements guard on `isIsoDate` because Zod runs object-level
// refinements even when a field check has already failed — without the guard a
// malformed date reaches `calendarDaysBetween`, which throws, and a 422 becomes
// a 500.
export const ActivityGridQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
  })
  .refine((q) => !isIsoDate(q.from) || !isIsoDate(q.to) || calendarDaysBetween(q.from, q.to) >= 0, {
    error: "`to` must not be before `from`",
    path: ["to"],
  })
  .refine(
    (q) =>
      !isIsoDate(q.from) || !isIsoDate(q.to) || calendarDaysBetween(q.from, q.to) < MAX_GRID_DAYS,
    { error: `Ask for fewer than ${MAX_GRID_DAYS} days`, path: ["to"] },
  );
export type ActivityGridQuery = z.infer<typeof ActivityGridQuerySchema>;
