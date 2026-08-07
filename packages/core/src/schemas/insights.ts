import { z } from "zod";
import { GRID_LAYERS } from "../insights/activity-grid.js";
import { BACKLOG_WINDOW_DAYS } from "../insights/backlog.js";
import { calendarDaysBetween } from "../time/calendar.js";
import { IsoDateSchema } from "./planning.js";

/**
 * The read-only dashboard queries (§6's `insights` module).
 *
 * §6's route table lists `/focus`, `/friction`, `/learning`, `/consumption-vs-retention` and
 * `/backlog`, and assigns the activity grid nowhere. It goes here, under `/insights/activity`,
 * because it reads `daily_activity` like the rest of this module and nothing in `planning` owns a
 * year of days.
 */

/** A desktop year, and a little slack. Bounded so one request cannot ask for a decade. */
export const MAX_GRID_DAYS = 400;

export const GridLayerSchema = z.enum(GRID_LAYERS);

/**
 * §3.9's five layers are not all buildable: reviews, lessons and artifacts have no source table
 * until M4–M6. The enum is the two that do, so an unbuilt layer is a 422 rather than a screen full
 * of zeroes claiming you completed no reviews.
 */
export const ActivityGridQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    layer: GridLayerSchema.default("focus"),
  })
  .refine((q) => calendarDaysBetween(q.from, q.to) >= 0, {
    error: "`to` must not be before `from`",
    path: ["to"],
  })
  .refine((q) => calendarDaysBetween(q.from, q.to) < MAX_GRID_DAYS, {
    error: `Ask for fewer than ${MAX_GRID_DAYS} days`,
    path: ["to"],
  });
export type ActivityGridQuery = z.infer<typeof ActivityGridQuerySchema>;

export const BacklogQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(7).max(365).default(BACKLOG_WINDOW_DAYS),
});
export type BacklogQuery = z.infer<typeof BacklogQuerySchema>;
