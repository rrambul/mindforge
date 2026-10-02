import { z } from "zod";

/**
 * How a lesson landed (FR-P1).
 *
 * Three values, and the middle one is the point. `shaky` is the honest answer most
 * of the time, and a scale with a numeric middle invites you to average yourself
 * into it rather than decide — the same argument `INTENTION_OUTCOMES` makes for the
 * debrief. A `shaky` lesson counts as completed and stays visibly shaky until you
 * redo it (FR-P4); nothing decays it and nothing rounds it up.
 *
 * Stored as these keys and translated at render, like every other enum (§5.2).
 */
export const LESSON_OUTCOMES = ["understood", "shaky", "lost"] as const;
export type LessonOutcome = (typeof LESSON_OUTCOMES)[number];
export const LessonOutcomeSchema = z.enum(LESSON_OUTCOMES);

/**
 * What a `lessons` row is (FR-E1). An exam is a lesson file that says it is one with
 * `<meta name="mindforge:kind" content="exam">`, indexed onto the same table so it
 * gets the reader, the grant and the exercise attempts for nothing — and so every
 * derivation that counts lessons has to leave it out (FR-E2).
 */
export const LESSON_KINDS = ["lesson", "exam"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];
export const LessonKindSchema = z.enum(LESSON_KINDS);

/** A raw `lessons.kind`, narrowed: anything but `exam` is a lesson, which is the column's default. */
export function asLessonKind(value: string | null | undefined): LessonKind {
  return value === "exam" ? "exam" : "lesson";
}

/**
 * Completing a lesson from the reader: one required field, which is what makes the
 * capture two taps — open the tray, pick the outcome (§7.1).
 *
 * The outcome is **required**, and that is deliberate. An optional one would be left
 * blank by everybody in a hurry, and a module of completed lessons with no outcomes
 * is a progress bar with nothing behind it. There is a separate way to undo a
 * completion; there is no way to record one without saying how it went.
 */
export const CompleteLessonSchema = z.object({
  outcome: LessonOutcomeSchema,
});
export type CompleteLessonInput = z.infer<typeof CompleteLessonSchema>;

/**
 * A raw `lessons.outcome` column value, narrowed at the boundary where a row
 * becomes a view.
 *
 * The column is CHECKed to the three, so anything else is a row written around
 * the constraint — read as "no outcome recorded" rather than passed through,
 * because a fourth value reaching the SPA is a translation key that does not
 * exist and renders as the raw string.
 *
 * Here rather than in each Prisma reader: two copies of this is two answers to
 * what the column may hold, and the one that gets updated is never both.
 */
export function asLessonOutcome(value: string | null): LessonOutcome | null {
  return (LESSON_OUTCOMES as readonly string[]).includes(value ?? "")
    ? (value as LessonOutcome)
    : null;
}
