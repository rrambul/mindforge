import { z } from "zod";
import { UuidSchema } from "./common.js";

/**
 * The focus session contract (FR-F1, FR-F2, FR-F3).
 *
 * The shape of these schemas *is* the ≤5s/≤2-tap budget expressed as types: starting a
 * session asks for one optional field, and stopping asks for nothing at all. Everything
 * that could be asked at the start but does not have to be is asked in the debrief
 * instead, where you have thirty seconds rather than five.
 */

/**
 * How the session got recorded. `timer` ran live; `manual` was entered for something you
 * did today; `backfilled` is older than that.
 *
 * Distinguished because FR-F2 is explicit that backfilled data must be *distinguishable
 * without being second-class* — an insight built only on timer sessions would quietly
 * describe the days you remembered to press start, which is a different population from
 * the days you worked.
 */
export const ENTRY_MODES = ["timer", "manual", "backfilled"] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];
export const EntryModeSchema = z.enum(ENTRY_MODES);

/**
 * Did the block do what you set out to do. Three values, not five: the middle one is the
 * honest and common answer, and a 1–5 scale here would invite you to average yourself
 * into a 3 rather than decide.
 */
export const INTENTION_OUTCOMES = ["yes", "partly", "no"] as const;
export type IntentionOutcome = (typeof INTENTION_OUTCOMES)[number];
export const IntentionOutcomeSchema = z.enum(INTENTION_OUTCOMES);

/** 1–5 for the two debrief ratings. Integers — a 3.5 is not a thing you can feel. */
const rating = z.coerce.number().int().min(1).max(5);

const intention = z.string().trim().max(500).nullable();

/**
 * "What does done look like for this block?" — one field, asked at start (§5.3).
 *
 * `id` is accepted from the client because this is a capture path: §6.1 makes these
 * endpoints idempotent upserts on a client-generated UUID, which is what lets the offline
 * queue replay a start without risking two sessions.
 */
export const StartFocusSessionSchema = z.object({
  id: UuidSchema.optional(),
  intention: intention.optional(),
  missionId: UuidSchema.nullable().optional(),
  /** Optional Pomodoro-style target. FR-F1: intervals are optional, never mandatory. */
  plannedMinutes: z.coerce.number().int().min(1).max(600).nullable().optional(),
});
export type StartFocusSessionInput = z.infer<typeof StartFocusSessionSchema>;

/**
 * The ≤30-second debrief (FR-F3). Every field optional, deliberately.
 *
 * A required debrief is a debrief you learn to dismiss, and a dismissed debrief teaches
 * the app that every session was fine. Stopping already recorded the thing that matters
 * most — that time was spent — so this is allowed to be partial.
 */
export const DebriefFocusSessionSchema = z
  .object({
    hitIntention: IntentionOutcomeSchema.optional(),
    focusQuality: rating.optional(),
    energy: rating.optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: "Provide at least one debrief field",
    path: ["hitIntention"],
  });
export type DebriefFocusSessionInput = z.infer<typeof DebriefFocusSessionSchema>;

/**
 * Manual and retroactive entry (FR-F2). You *will* forget the timer, and if backfilling is
 * painful the data dies within two weeks — so this takes the same shape as a real session
 * rather than being a reduced afterthought.
 *
 * `startedAt` and `endedAt` are both required: an entry you are making after the fact is
 * one whose boundaries you already know.
 */
export const CreateFocusSessionSchema = z
  .object({
    id: UuidSchema.optional(),
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date(),
    intention: intention.optional(),
    missionId: UuidSchema.nullable().optional(),
    hitIntention: IntentionOutcomeSchema.optional(),
    focusQuality: rating.optional(),
    energy: rating.optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
  })
  .refine((body) => body.endedAt > body.startedAt, {
    error: "A session must end after it started",
    path: ["endedAt"],
  });
export type CreateFocusSessionInput = z.infer<typeof CreateFocusSessionSchema>;

export const ListFocusSessionsQuerySchema = z.object({
  missionId: UuidSchema.optional(),
  /** Inclusive lower bound, in the user's timezone as resolved by the caller. */
  since: z.coerce.date().optional(),
});
export type ListFocusSessionsQuery = z.infer<typeof ListFocusSessionsQuerySchema>;

/** Whole minutes, rounded down. A session is over when it ends, not when it rounds up. */
export function elapsedMinutes(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 60_000));
}
