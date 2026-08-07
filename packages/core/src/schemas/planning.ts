import { z } from "zod";
import { isIsoDate } from "../time/calendar.js";
import { UuidSchema } from "./common.js";

/**
 * The weekly plan and the weekly review (FR-F5, FR-F6) — §6's `planning` module.
 *
 * Not a capture path, and shaped accordingly. §7.1's ≤5s/≤2-tap budget names focus start/stop,
 * friction, and progress; sitting down to decide next week's hours is a considered act, closer to
 * creating a goal than to tapping a chip. So there are no client-generated ids here and nothing is
 * queued offline — a plan that silently replayed on reconnect could overwrite one you made in the
 * meantime, and losing a decision is worse than seeing the request fail.
 */

/**
 * `YYYY-MM-DD`, and a real date.
 *
 * A string rather than `z.coerce.date()` on purpose. A week start is a calendar fact in the user's
 * timezone (§5.2), and coercing it to a `Date` gives it a UTC midnight it does not have — which is
 * how `2026-08-03` becomes `2026-08-02` for everyone west of Greenwich the first time somebody
 * formats it back.
 */
export const IsoDateSchema = z.string().refine(isIsoDate, { error: "Expected a date, YYYY-MM-DD" });

/** Ten hours a day for seven days. Not a judgement — an upper bound that catches a typo. */
export const MAX_PLANNED_MINUTES = 70 * 60;

/**
 * One allocation. Exactly one subject, matching the check constraint on the table: an allocation
 * against both would be counted twice by plan-vs-actual, and against neither is a target with
 * nothing to aim at.
 */
export const AllocationSchema = z
  .object({
    missionId: UuidSchema.nullable().optional(),
    skillId: UuidSchema.nullable().optional(),
    /**
     * Positive. Zero is the absence of an allocation rather than an allocation of nothing, and the
     * grid deletes the row when you clear the field — otherwise plan-vs-actual lists weeks of
     * things you never intended to do.
     */
    plannedMinutes: z.coerce.number().int().min(1).max(MAX_PLANNED_MINUTES),
  })
  .refine((a) => (a.missionId == null) !== (a.skillId == null), {
    error: "Name exactly one mission or one skill",
    path: ["missionId"],
  });
export type AllocationInput = z.infer<typeof AllocationSchema>;

/**
 * The whole week, replaced at once.
 *
 * A PUT rather than a per-row PATCH because the grid is edited as a grid: you shift an hour from one
 * mission to another and press save, and two independent requests can land in either order and leave
 * the week over-allocated in between. Sending the whole set makes the plan a single value, which is
 * also what makes "you removed that row" expressible at all.
 */
export const PutWeeklyPlanSchema = z.object({
  allocations: z.array(AllocationSchema).max(50),
});
export type PutWeeklyPlanInput = z.infer<typeof PutWeeklyPlanSchema>;

/**
 * The ritual's output (FR-F6).
 *
 * `changedOneThing` is the field M2's finish line is written in — "you've done three weekly reviews
 * and changed one thing because of one" (NORTHSTAR.md §4). It is optional because a week where
 * nothing needs changing is a real answer and forcing a sentence would produce a fabricated one,
 * which is exactly the reflex §7.2 exists to prevent.
 */
export const CompleteWeeklyReviewSchema = z.object({
  changedOneThing: z.string().trim().min(1).max(280).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type CompleteWeeklyReviewInput = z.infer<typeof CompleteWeeklyReviewSchema>;
