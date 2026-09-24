import { z } from "zod";

import { EXERCISE_CODE_MAX, RUN_STATUSES, TestResultSchema } from "./exercise.js";

/**
 * Hints — help when you are stuck, one rung at a time (FR-H1–H4, `PLAN-HANDS-ON.md` Phase 2).
 *
 * The ladder is the design. An assistant that hands over the answer on the first
 * ask turns an exercise back into reading, which is the thing Phase 1 exists to
 * undo — so help escalates, and each rung gives away a little more than the last:
 *
 * 1. **question** — one question that points at the gap. No answer, no code.
 * 2. **clue** — where the problem is, and why that place. Not the fix.
 * 3. **concept** — the idea the learner is missing, with an example that is not
 *    their exercise.
 * 4. **structure** — the shape of a solution, as steps or pseudocode. Not runnable.
 * 5. **code** — the part of the solution they need, explained.
 *
 * The same order `engineer-flow` uses for a person coaching a person.
 */
export const HINT_RUNGS = ["question", "clue", "concept", "structure", "code"] as const;
export type HintRung = (typeof HINT_RUNGS)[number];

/** 1-based, as the learner sees it: "hint 3 of 5". */
export const HintLevelSchema = z.number().int().min(1).max(HINT_RUNGS.length);

export function rungOf(level: number): HintRung {
  return HINT_RUNGS[Math.min(HINT_RUNGS.length, Math.max(1, level)) - 1]!;
}

/**
 * The highest rung a learner may ask for next.
 *
 * One above the highest they have had, so the ladder cannot be skipped straight to
 * the code — and never below 1. Asking again at a rung already reached is always
 * allowed: "say that differently" is not an escalation.
 */
export function nextAllowedLevel(highestSoFar: number | null): number {
  return Math.min(HINT_RUNGS.length, (highestSoFar ?? 0) + 1);
}

/** A question in the learner's own words, answered within the rung they are on. */
export const HINT_QUESTION_MAX = 1_000;

/**
 * `POST /v1/lessons/:lessonId/exercises/:key/hints`.
 *
 * The code and the last run travel with the request rather than being read back
 * from the latest attempt, because the learner is usually stuck on code they have
 * not run yet — the attempt on record is the one *before* what they are looking at.
 */
export const RequestHintSchema = z.object({
  level: HintLevelSchema,
  code: z.string().max(EXERCISE_CODE_MAX),
  lastRun: z
    .object({
      status: z.enum(RUN_STATUSES),
      results: z.array(TestResultSchema).max(200),
      message: z.string().max(4_000).nullable(),
    })
    .nullable()
    .default(null),
  question: z.string().trim().min(1).max(HINT_QUESTION_MAX).nullable().default(null),
});
export type RequestHintInput = z.infer<typeof RequestHintSchema>;
