import { z } from "zod";
import { FRICTION_TYPES, type FrictionType } from "../friction/classify.js";
import { UuidSchema } from "./common.js";

/**
 * The friction contract (FR-C1, FR-C2) — the heart of the product, and the single most
 * mobile interaction in it: logged mid-session, one-handed, usually while annoyed.
 *
 * Everything optional except the type. That is the ≤5s/≤2-tap budget: a tap sends a type
 * and nothing else, and intensity, note, and attachments are all things the server or a
 * later debrief can fill in.
 */

export const FrictionTypeSchema = z.enum(FRICTION_TYPES);

/**
 * §5.3: intensity defaults to 3 and is **never asked for inline**. You can adjust it later
 * from the session debrief, where you have the time. Asking at the moment of annoyance
 * turns a one-tap capture into a two-step form, and the answer you would give while
 * annoyed is not better than 3.
 */
export const DEFAULT_FRICTION_INTENSITY = 3;

export const LogFrictionSchema = z.object({
  /** Client-generated, so the offline queue can replay a tap without duplicating it (§6.1). */
  id: UuidSchema.optional(),
  type: FrictionTypeSchema,
  intensity: z.coerce.number().int().min(1).max(5).default(DEFAULT_FRICTION_INTENSITY),
  note: z.string().trim().max(500).nullable().optional(),
  /**
   * Attached to the running session when one exists. The client sends it rather than the
   * server inferring it, because the offline queue may replay this long after the session
   * ended — and it must land on the session it happened in, not the one running now.
   */
  sessionId: UuidSchema.nullable().optional(),
  skillId: UuidSchema.nullable().optional(),
  resourceId: UuidSchema.nullable().optional(),
  taskId: UuidSchema.nullable().optional(),
  /**
   * When it happened, not when it was sent. Defaulted server-side when absent, but a
   * queued event must carry its own timestamp or an afternoon spent offline arrives as a
   * burst of friction at reconnect.
   */
  occurredAt: z.coerce.date().optional(),
});
export type LogFrictionInput = z.infer<typeof LogFrictionSchema>;

export const FrictionSummaryQuerySchema = z.object({
  since: z.coerce.date().optional(),
  /**
   * Exclusive upper bound. Absent means "up to now", which is what a dashboard wants.
   *
   * Added in M2 because the weekly review needs a *closed* window: without it, reviewing the week of
   * the 2nd counted every event since the 2nd, so an old review silently included everything that
   * happened after it. The screen was honest about that in a caption, which is worse than being
   * right when the fix is one bound.
   */
  until: z.coerce.date().optional(),
  missionId: UuidSchema.optional(),
});
export type FrictionSummaryQuery = z.infer<typeof FrictionSummaryQuerySchema>;

/**
 * The chips shown inline, and the ones behind "More".
 *
 * §5.3 states the conflict plainly: eleven types and a one-tap budget are in direct
 * conflict, and eleven chips is not a one-tap UI at 375px. The resolution is four —
 * your three most-used over the window, plus one pinned.
 */
export const INLINE_CHIP_COUNT = 4;

/**
 * The window the ranking reads. §5.3: "your three most-used types over the last 30 days".
 *
 * Long enough that the chips reflect how you actually work, short enough that they follow you
 * when that changes — a lifetime ranking would freeze whatever you struggled with in your first
 * fortnight.
 */
export const CHIP_WINDOW_DAYS = 30;

/**
 * Pinned permanently, and it is the whole reason this function is not just "top four".
 *
 * §5.3: it is the type people under-report and the one the product most needs, because
 * nobody volunteers "this was hard in a good way" unless it is in front of them. If it
 * ranked on usage it would never appear, and the ember share would read as a fact about
 * the learner rather than about the interface.
 */
export const PINNED_FRICTION_TYPE: FrictionType = "productive_struggle";

/**
 * Before there is usage data. §5.3 names these four exactly.
 */
export const COLD_START_CHIPS: readonly FrictionType[] = [
  "interruption",
  "tooling",
  "too_hard",
  PINNED_FRICTION_TYPE,
];

export interface FrictionChips {
  /** Exactly four, with the pinned type always last so its position never moves. */
  readonly inline: readonly FrictionType[];
  /** The rest, for the bottom sheet. */
  readonly overflow: readonly FrictionType[];
}

/**
 * Tiebreak order: the documented cold-start choices first, then everything else.
 *
 * Ties are the normal case, not the edge one — a new account has eleven zeroes, and a
 * month in most types are still zero. Breaking them on the raw declaration order of
 * FRICTION_TYPES would surface `self_interruption` where §5.3 asks for `tooling`, so the
 * preference the doc states is encoded here rather than left to coincide with an array's
 * order.
 */
const TIEBREAK_ORDER: readonly FrictionType[] = [
  ...COLD_START_CHIPS.filter((type) => type !== PINNED_FRICTION_TYPE),
  ...FRICTION_TYPES.filter(
    (type) => type !== PINNED_FRICTION_TYPE && !COLD_START_CHIPS.includes(type),
  ),
];

/**
 * Ranks the chips from recent usage.
 *
 * Pure, and in `packages/core`, because the SPA needs it to render the bar and the API
 * needs the same order for the eventual command-palette action registry — a bar whose
 * chips disagreed with the palette's would be two different products.
 *
 * The pinned type is excluded from the ranking and appended, so it occupies one of the
 * four rather than competing for it. Ordering is deterministic: chips that reshuffle
 * between renders are unusable as muscle memory, and muscle memory is the entire point of
 * a one-tap control.
 */
export function frictionChips(
  counts: Readonly<Partial<Record<FrictionType, number>>>,
): FrictionChips {
  const ranked = TIEBREAK_ORDER.map((type, preference) => ({
    type,
    count: counts[type] ?? 0,
    preference,
  }))
    .sort((a, b) => b.count - a.count || a.preference - b.preference)
    .map((entry) => entry.type);

  return {
    inline: [...ranked.slice(0, INLINE_CHIP_COUNT - 1), PINNED_FRICTION_TYPE],
    overflow: ranked.slice(INLINE_CHIP_COUNT - 1),
  };
}

/**
 * What a friction event was about (§5.3).
 *
 * Set from the session debrief, never at the chip tap: the chip is the one-tap capture the whole
 * feature is built around, and asking "which skill?" mid-annoyance would break it. §5.3 puts friction
 * detail in the debrief "where you have the time".
 *
 * Both fields are nullable so an attribution can be *retracted* — "actually this was not about that
 * skill" has to be sayable, or a wrong guess becomes permanent. Absent means unchanged, which is
 * different from present-and-null.
 */
export const AttributeFrictionSchema = z
  .object({
    skillId: UuidSchema.nullable().optional(),
    resourceId: UuidSchema.nullable().optional(),
  })
  .refine((patch) => patch.skillId !== undefined || patch.resourceId !== undefined, {
    error: "Name a skill or a resource, or clear one",
    path: ["skillId"],
  });
export type AttributeFrictionInput = z.infer<typeof AttributeFrictionSchema>;
