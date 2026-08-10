import { z } from "zod";
import { isIsoDate } from "../time/calendar.js";

/**
 * Shapes that belong to no single feature.
 *
 * `UuidSchema` matters more than it looks: every id in this product reaches a
 * Postgres `uuid` column, and an unvalidated one gets there as a failed cast —
 * which surfaces as a 500 from the driver rather than the 422 it actually is.
 * Validating at the boundary keeps a typo in a URL an ordinary client error.
 */
export const UuidSchema = z.uuid();

/** A calendar date, `YYYY-MM-DD`, as `time/calendar.ts` defines one. */
export const IsoDateSchema = z.string().refine(isIsoDate, { error: "Expected a date, YYYY-MM-DD" });

/**
 * Cursor pagination for the unbounded lists — focus sessions, lessons (§6.1).
 * Offset pagination breaks the moment a nightly job inserts rows mid-scroll,
 * which for this product is every night.
 */
export const PaginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type Pagination = z.infer<typeof PaginationSchema>;
