import type { LessonOutcome } from "../schemas/lesson.js";

/**
 * Was that lesson too hard, about right, or too easy? (FR-D1–D3, `PLAN-HANDS-ON.md` Phase 3.)
 *
 * The one implementation, used by the API (the reader and the curriculum screen
 * show it) and by the briefing (the next run is told it). Derived on read from raw
 * rows, never stored (principle 2) — which is also what lets a later attempt revise
 * it: a lesson that was "too hard" on Tuesday and passed on Thursday is, on
 * Thursday, not too hard any more.
 *
 * The rules are deliberately few and written down, so they can be argued with. The
 * inputs are what the learner *did* — attempts, hints, time — plus the one thing
 * they *said*, the outcome chip. The chip is never prefilled from this; the two are
 * shown side by side, not blended.
 *
 * - **too-hard**: marked `lost`; or tried and never passed; or passed only after a
 *   hint at rung 4 (the shape of a solution) or 5 (the code).
 * - **too-easy**: every exercise passed on its first attempt, with no hint before
 *   the pass, in at most half the lesson's expected minutes, and not marked `shaky`
 *   or `lost`. **Timing must be known** — a first-try pass with no clock behind it
 *   could have taken an hour, and calling it easy would be a guess that pushes the
 *   next lesson harder.
 * - **in-zone**: everything else that was measured.
 * - **null**: nothing to judge yet — the lesson is not finished, or it has no exercise
 *   and no `lost`, or its exercises were never tried. Never rendered as "in the zone"
 *   (non-negotiable 10: unknown is not a value).
 *
 * **Only a finished lesson is judged.** A learner three failing runs into an exercise
 * is working, not failing, and a verdict of "too hard" at that moment would be both
 * wrong and discouraging. So a lesson with no outcome recorded is `in-progress`, and
 * the verdict is drawn when they say they are done — which is also exactly when the
 * next lesson's run reads it.
 */

/** Rungs 4 and 5 — the shape of a solution and the code — mean the learner was shown the way. */
export const HEAVY_HINT_LEVEL = 4;

/** A pass at or under this fraction of the expected minutes is fast. */
export const FAST_FRACTION = 0.5;

export interface AttemptFact {
  readonly createdAt: Date;
  readonly passed: boolean;
  /** When the learner first changed the starter, as reported with the attempt. */
  readonly startedAt: Date | null;
}

export interface HintFact {
  readonly level: number;
  readonly createdAt: Date;
}

export interface ExerciseFacts {
  readonly expectedMinutes: number | null;
  /** Every attempt, in any order. */
  readonly attempts: readonly AttemptFact[];
  /** Every hint given, in any order. */
  readonly hints: readonly HintFact[];
}

/** What one exercise shows, before any verdict. */
export interface ExerciseEvidence {
  readonly attempted: boolean;
  readonly passed: boolean;
  /** Attempts up to and including the first pass. Null when it never passed. */
  readonly attemptsToPass: number | null;
  /** The highest rung asked for before the first pass — or at all, when it never passed. Null for none. */
  readonly highestHintBeforePass: number | null;
  /** From the earliest recorded start to the first pass. Null when either end is unknown. */
  readonly minutesToPass: number | null;
  readonly expectedMinutes: number | null;
}

export function exerciseEvidence(facts: ExerciseFacts): ExerciseEvidence {
  const attempts = [...facts.attempts].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const firstPass = attempts.findIndex((attempt) => attempt.passed);
  const passedAt = firstPass === -1 ? null : attempts[firstPass]!.createdAt;

  const before =
    passedAt === null ? facts.hints : facts.hints.filter((h) => h.createdAt <= passedAt);
  const highest = before.length === 0 ? null : Math.max(...before.map((h) => h.level));

  const starts = attempts
    .slice(0, firstPass === -1 ? 0 : firstPass + 1)
    .flatMap((attempt) => (attempt.startedAt === null ? [] : [attempt.startedAt.getTime()]));
  const minutesToPass =
    passedAt === null || starts.length === 0
      ? null
      : Math.max(0, (passedAt.getTime() - Math.min(...starts)) / 60_000);

  return {
    attempted: attempts.length > 0,
    passed: passedAt !== null,
    attemptsToPass: firstPass === -1 ? null : firstPass + 1,
    highestHintBeforePass: highest,
    minutesToPass,
    expectedMinutes: facts.expectedMinutes,
  };
}

export const STRAIN_VERDICTS = ["too-hard", "in-zone", "too-easy"] as const;
export type StrainVerdict = (typeof STRAIN_VERDICTS)[number];

/**
 * Why a verdict was reached, as keys the UI translates and the briefing spells
 * out. Every verdict carries at least one, so no verdict is ever shown bare.
 */
export const STRAIN_REASONS = [
  "marked-lost",
  "never-passed",
  "heavy-hints",
  "first-try-no-hints-fast",
  "passed",
] as const;
export type StrainReason = (typeof STRAIN_REASONS)[number];

export type Strain =
  | { readonly verdict: StrainVerdict; readonly reasons: readonly StrainReason[] }
  | { readonly verdict: null; readonly unknown: "in-progress" | "no-exercise" | "not-attempted" };

/** `outcome` null means the lesson has not been finished, which is `in-progress`. */
export function lessonStrain(
  outcome: LessonOutcome | null,
  exercises: readonly ExerciseEvidence[],
): Strain {
  if (outcome === null) return { verdict: null, unknown: "in-progress" };

  const tried = exercises.filter((e) => e.attempted);
  const reasons: StrainReason[] = [];

  if (outcome === "lost") reasons.push("marked-lost");
  if (tried.some((e) => !e.passed)) reasons.push("never-passed");
  if (tried.some((e) => e.passed && (e.highestHintBeforePass ?? 0) >= HEAVY_HINT_LEVEL)) {
    reasons.push("heavy-hints");
  }
  if (reasons.length > 0) return { verdict: "too-hard", reasons };

  if (tried.length === 0) {
    return { verdict: null, unknown: exercises.length === 0 ? "no-exercise" : "not-attempted" };
  }

  const easy =
    tried.length === exercises.length &&
    outcome !== "shaky" &&
    tried.every(
      (e) =>
        e.attemptsToPass === 1 &&
        e.highestHintBeforePass === null &&
        e.minutesToPass !== null &&
        e.expectedMinutes !== null &&
        e.minutesToPass <= e.expectedMinutes * FAST_FRACTION,
    );

  return easy
    ? { verdict: "too-easy", reasons: ["first-try-no-hints-fast"] }
    : { verdict: "in-zone", reasons: ["passed"] };
}

export interface JudgedLesson {
  readonly lessonId: string;
  readonly slug: string;
  readonly title: string;
  readonly strain: Strain;
  /** A bridge lesson toward this one already exists — written, finished or not. */
  readonly bridged: boolean;
}

/**
 * What the next lesson should do about how the last ones landed (FR-D2, FR-D3).
 *
 * Read newest first, skipping lessons with nothing to judge:
 *
 * - **bridge** — the newest judged lesson was too hard and has no bridge yet. Write a
 *   smaller step toward it, before moving on. Never a rewrite: the lesson and what
 *   the learner did with it stay as they are. **One bridge per lesson**: until the
 *   bridge is finished, the too-hard lesson is still the newest judged one, and
 *   without this every press would order another step toward it.
 * - **harder** — the two newest judged lessons were both too easy. One is chance;
 *   two in a row is the plan pitched low.
 * - **as-planned** — otherwise.
 * - **null** — nothing judged yet, which is not the same as "as planned" and is
 *   never told to a run as if it were.
 */
export type Adjustment =
  | { readonly kind: "bridge"; readonly lesson: JudgedLesson }
  | { readonly kind: "harder"; readonly because: readonly [JudgedLesson, JudgedLesson] }
  | { readonly kind: "as-planned" }
  | null;

export function nextAdjustment(newestFirst: readonly JudgedLesson[]): Adjustment {
  const judged = newestFirst.filter((lesson) => lesson.strain.verdict !== null);
  const [latest, previous] = judged;

  if (latest === undefined) return null;
  if (latest.strain.verdict === "too-hard") {
    return latest.bridged ? { kind: "as-planned" } : { kind: "bridge", lesson: latest };
  }
  if (
    previous !== undefined &&
    latest.strain.verdict === "too-easy" &&
    previous.strain.verdict === "too-easy"
  ) {
    return { kind: "harder", because: [latest, previous] };
  }
  return { kind: "as-planned" };
}

export interface AdaptableLesson {
  readonly id: string;
  readonly slug: string;
  readonly seq: number | null;
  readonly adjustment: {
    readonly kind: "bridge" | "harder";
    readonly bridgeForSlug: string | null;
  } | null;
}

export interface Bridges {
  /** Bridge lesson id → the lesson it steps toward. */
  readonly target: ReadonlyMap<string, string>;
  /** Lesson id → the bridge written toward it (the first, by sequence). */
  readonly bridgeOf: ReadonlyMap<string, string>;
}

/**
 * Which lesson each bridge steps toward, and the reverse (FR-D2).
 *
 * By slug, the way a plan entry is claimed: the bridge's `mindforge:bridge-for`
 * names a slug, and written lessons may share one (only planned slugs are unique),
 * so the earliest written lesson with that slug wins — the one the learner met
 * first, which is the one that was too hard. A slug that names nothing resolves to
 * nothing, and the screen says "a smaller step" without a link rather than
 * guessing at one.
 */
export function resolveBridges(lessons: readonly AdaptableLesson[]): Bridges {
  const bySlug = new Map<string, AdaptableLesson>();
  for (const lesson of [...lessons].sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity))) {
    if (!bySlug.has(lesson.slug)) bySlug.set(lesson.slug, lesson);
  }

  const target = new Map<string, string>();
  const bridgeOf = new Map<string, string>();
  const bridges = lessons
    .filter((lesson) => lesson.adjustment?.kind === "bridge")
    .sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));

  for (const bridge of bridges) {
    const slug = bridge.adjustment!.bridgeForSlug;
    const toward = slug === null ? undefined : bySlug.get(slug);
    if (toward === undefined || toward.id === bridge.id) continue;
    target.set(bridge.id, toward.id);
    if (!bridgeOf.has(toward.id)) bridgeOf.set(toward.id, bridge.id);
  }

  return { target, bridgeOf };
}
