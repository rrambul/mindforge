import { z } from "zod";
import { BANDS } from "../scoring/bands.js";
import { UuidSchema } from "./common.js";

/**
 * Goals and their typed targets (FR-M3, §3.8).
 *
 * The one rule everything here serves: **progress is computed, never entered.** There is no percent
 * field and no slider anywhere in this file, because a hand-entered number is self-report wearing a
 * number's clothes — the exact failure REQUIREMENTS.md §7.2 exists to prevent.
 */

export const GOAL_STATUSES = ["active", "met", "missed", "abandoned"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Active first, then what is over. A goal that failed is data, not a blemish. */
export const GOAL_STATUS_ORDER: readonly GoalStatus[] = [
  "active",
  "met",
  "missed",
  "abandoned",
] as const;

export function goalStatusRank(status: GoalStatus): number {
  return GOAL_STATUS_ORDER.indexOf(status);
}

export const TARGET_KINDS = [
  "resource_progress",
  "skill_band",
  "artifact",
  "focus_hours",
  "review_accuracy",
  "lessons_completed",
  "manual",
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/**
 * Which kinds have a data source in M1.
 *
 * The others are not disabled — a target can be created for any of them, and doing so is the honest
 * way to write down a goal about shipping something. They simply report *unmeasurable* until the
 * feature that feeds them lands, which is a true statement, unlike 0%.
 */
export const MEASURABLE_KINDS_M1: readonly TargetKind[] = [
  "resource_progress",
  "focus_hours",
  "manual",
] as const;

/** Which entity a kind points at. `null` means it stands alone. */
export const SUBJECT_FOR_KIND: Readonly<
  Record<TargetKind, "resource" | "skill" | "mission" | null>
> = {
  resource_progress: "resource",
  skill_band: "skill",
  artifact: null,
  focus_hours: "mission",
  review_accuracy: "skill",
  lessons_completed: "mission",
  manual: null,
};

/**
 * A calendar day, `YYYY-MM-DD`.
 *
 * Kept as a string rather than coerced to a `Date`, because a target date is a day in the user's own
 * calendar and a `Date` is an instant: `new Date("2026-08-14")` is midnight UTC, which is the 13th in
 * São Paulo. The column is `date` for the same reason.
 */
const TargetDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "not a real date");

// ---------------------------------------------------------------------------
// Target definitions
// ---------------------------------------------------------------------------

const PercentTarget = z.object({ percent: z.coerce.number().int().min(1).max(100) });
const BandTarget = z.object({ band: z.enum(BANDS) });
const HoursTarget = z.object({ hours: z.coerce.number().positive().max(10_000) });
const CountTarget = z.object({ count: z.coerce.number().int().positive().max(10_000) });
const AccuracyTarget = z.object({
  accuracy: z.coerce.number().min(0).max(1),
  // A rolling accuracy with no window is not a measurement — "85% accurate" over all time says
  // nothing about whether you know it now.
  windowDays: z.coerce.number().int().min(1).max(365).default(30),
});
/** Nothing to parameterise: it is done or it is not. */
const BinaryTarget = z.object({});

export const TargetDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resource_progress"), resourceId: UuidSchema, target: PercentTarget }),
  z.object({ kind: z.literal("skill_band"), skillId: UuidSchema, target: BandTarget }),
  z.object({ kind: z.literal("artifact"), target: BinaryTarget }),
  z.object({ kind: z.literal("focus_hours"), missionId: UuidSchema, target: HoursTarget }),
  z.object({ kind: z.literal("review_accuracy"), skillId: UuidSchema, target: AccuracyTarget }),
  z.object({ kind: z.literal("lessons_completed"), missionId: UuidSchema, target: CountTarget }),
  z.object({ kind: z.literal("manual"), target: BinaryTarget }),
]);
export type TargetDefinition = z.infer<typeof TargetDefinitionSchema>;

/**
 * Weight, for the goal's weighted mean.
 *
 * Bounded well below the column's `numeric(4,2)` so a typo cannot make one target swamp the rest and
 * turn the mean into a single number wearing a mean's clothes.
 */
const WeightSchema = z.coerce.number().positive().max(10).default(1);

export const CreateGoalTargetSchema = z.intersection(
  TargetDefinitionSchema,
  z.object({ id: UuidSchema.optional(), weight: WeightSchema }),
);
export type CreateGoalTargetInput = z.infer<typeof CreateGoalTargetSchema>;

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export const CreateGoalSchema = z.object({
  id: UuidSchema.optional(),
  missionId: UuidSchema.optional(),
  title: z.string().trim().min(1).max(200),
  definitionOfDone: z.string().trim().min(1).max(2_000).optional(),
  // A `date` column, not a timestamp: "by the 14th" is a day in the user's own calendar, and
  // coercing it through a timestamp would make it land on the 13th for anyone west of UTC.
  targetDate: TargetDateSchema.optional(),
  // Targets can be added at creation or later. Not required: a goal you have written down but not
  // yet worked out how to measure is a real state, and refusing it would mean losing the goal.
  targets: z.array(CreateGoalTargetSchema).max(20).default([]),
});
export type CreateGoalInput = z.infer<typeof CreateGoalSchema>;

export const UpdateGoalSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    definitionOfDone: z.string().trim().min(1).max(2_000).nullable().optional(),
    targetDate: TargetDateSchema.nullable().optional(),
    missionId: UuidSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must change",
  });
export type UpdateGoalInput = z.infer<typeof UpdateGoalSchema>;

/**
 * Closing a goal.
 *
 * `outcomeNote` is required for `missed` and `abandoned` and optional for `met`, which is the
 * asymmetry that makes the data worth having: what stopped you is the thing you will want to read
 * later, and "met" usually speaks for itself.
 */
export const CloseGoalSchema = z
  .object({
    status: z.enum(["met", "missed", "abandoned"]),
    outcomeNote: z.string().trim().min(1).max(2_000).optional(),
  })
  .refine((value) => value.status === "met" || value.outcomeNote !== undefined, {
    path: ["outcomeNote"],
    message: "a missed or abandoned goal needs a note saying what happened",
  });
export type CloseGoalInput = z.infer<typeof CloseGoalSchema>;

export const ListGoalsQuerySchema = z.object({
  status: z.enum(GOAL_STATUSES).optional(),
  missionId: UuidSchema.optional(),
});
export type ListGoalsQuery = z.infer<typeof ListGoalsQuerySchema>;
