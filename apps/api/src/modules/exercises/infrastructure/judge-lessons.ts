import {
  asLessonOutcome,
  ExerciseDeclarationSchema,
  exerciseEvidence,
  lessonStrain,
  type ExerciseFacts,
  type Strain,
} from "@mindforge/core";

/**
 * Lessons → how each landed (FR-D1), for every screen and briefing that shows it.
 *
 * Three readers need the same verdict — the exercise panel, the curriculum screen
 * and the next run's briefing — and non-negotiable 3 says it is derived once. The
 * derivation is `lessonStrain` in `packages/core`; this is only the gathering: two
 * queries for any number of lessons, never one per lesson.
 *
 * Takes the caller's transaction rather than opening one, so the curriculum and the
 * briefing read their lessons and these facts from the same snapshot, under the same
 * RLS scope. That is also why it is a function rather than an injectable: the three
 * callers live in three modules, and a provider would make one of them import
 * another's module to reach it.
 */

/** The slice of a transaction handle this needs. */
export interface QueryTx {
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>;
}

export interface JudgeableLesson {
  readonly id: string;
  /** The raw column; narrowed here, like every reader narrows it. */
  readonly outcome: string | null;
  /** The raw `lessons.exercises` jsonb; re-validated here, like the exercise panel does. */
  readonly exercises: unknown;
}

interface AttemptRow {
  readonly lesson_id: string;
  readonly exercise_key: string;
  readonly created_at: Date;
  readonly passed: boolean;
  readonly started_at: Date | null;
}

interface HintRow {
  readonly lesson_id: string;
  readonly exercise_key: string;
  readonly level: number;
  readonly created_at: Date;
}

export async function judgeLessons(
  tx: QueryTx,
  lessons: readonly JudgeableLesson[],
): Promise<ReadonlyMap<string, Strain>> {
  const judged = new Map<string, Strain>();
  if (lessons.length === 0) return judged;

  const ids = lessons.map((lesson) => lesson.id);
  const attempts = await tx.$queryRawUnsafe<AttemptRow[]>(
    `select lesson_id, exercise_key, created_at, passed, started_at
       from exercise_attempts where lesson_id = any($1::uuid[])`,
    ids,
  );
  const hints = await tx.$queryRawUnsafe<HintRow[]>(
    `select lesson_id, exercise_key, level, created_at
       from exercise_hints where lesson_id = any($1::uuid[])`,
    ids,
  );

  for (const lesson of lessons) {
    const declared = Array.isArray(lesson.exercises) ? (lesson.exercises as unknown[]) : [];
    const facts: ExerciseFacts[] = declared.flatMap((entry) => {
      const parsed = ExerciseDeclarationSchema.safeParse(entry);
      if (!parsed.success) return [];
      const key = parsed.data.key;
      const mine = (row: { lesson_id: string; exercise_key: string }) =>
        row.lesson_id === lesson.id && row.exercise_key === key;

      return [
        {
          expectedMinutes: parsed.data.expectedMinutes,
          attempts: attempts.filter(mine).map((row) => ({
            createdAt: row.created_at,
            passed: row.passed,
            startedAt: row.started_at,
          })),
          hints: hints.filter(mine).map((row) => ({ level: row.level, createdAt: row.created_at })),
        },
      ];
    });

    judged.set(
      lesson.id,
      lessonStrain(asLessonOutcome(lesson.outcome), facts.map(exerciseEvidence)),
    );
  }

  return judged;
}
