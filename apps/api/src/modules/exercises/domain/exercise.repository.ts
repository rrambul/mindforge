import type { RunStatus, SceneElement, Strain, TestResult } from "@mindforge/core";

export const EXERCISE_REPOSITORY = Symbol("ExerciseRepository");

/** One attempt, as it is written. `passed` is already derived by `attemptPassed`. */
export interface NewAttempt {
  readonly lessonId: string;
  readonly exerciseKey: string;
  readonly code: string;
  readonly status: RunStatus;
  readonly results: readonly TestResult[];
  readonly passed: boolean;
  readonly startedAt: Date | null;
  readonly createdAt: Date;
}

/** What has happened with one exercise so far, derived from its attempts on read. */
export interface AttemptSummary {
  readonly count: number;
  readonly firstPassedAt: Date | null;
  readonly lastCode: string | null;
  readonly lastPassed: boolean | null;
  readonly lastAt: Date | null;
  /** The last attempt's results — tests, or rubric items for a review. */
  readonly lastResults: readonly TestResult[] | null;
  /** A whiteboard's last reviewed drawing. Null for code. */
  readonly lastScene: readonly SceneElement[] | null;
}

/** A task the learner ran on their own machine, and what they said happened. */
export interface NewReport {
  readonly lessonId: string;
  readonly exerciseKey: string;
  /** Their pasted terminal output, or empty when they gave none. */
  readonly output: string;
  readonly result: TestResult;
  readonly createdAt: Date;
}

/** A whiteboard review, as it is written: an attempt graded by review, and its bill. */
export interface NewReview {
  readonly lessonId: string;
  readonly exerciseKey: string;
  /** `describeScene` of the drawing — what the reviewer read, kept as the attempt's code. */
  readonly description: string;
  readonly scene: readonly SceneElement[];
  /** Null when the call produced no review: the cost row is still written, the attempt is not. */
  readonly review: {
    readonly results: readonly TestResult[];
    readonly passed: boolean;
    readonly feedback: string | null;
  } | null;
  readonly startedAt: Date | null;
  readonly call: HintCallCost;
}

/** One hint as it was given — or the reference solution, opened. */
export interface HintRecord {
  readonly kind: "hint" | "solution";
  readonly level: number;
  readonly question: string | null;
  readonly answer: string;
  readonly createdAt: Date;
}

/** What a hint call cost, for its `llm_calls` row (non-negotiable 9). */
export interface HintCallCost {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** Null when the model is not in the pricing table — never 0 as a stand-in (FR-T9). */
  readonly costUsd: number | null;
  readonly latencyMs: number;
  readonly requestId: string | null;
  readonly createdAt: Date;
}

export interface NewHint {
  readonly lessonId: string;
  readonly exerciseKey: string;
  readonly level: number;
  readonly question: string | null;
  /** Null when the call produced no hint: the cost row is still written. */
  readonly answer: string | null;
  readonly call: HintCallCost;
}

/** Opening an exercise's reference solution, recorded as the top rung of help. */
export interface NewSolutionReveal {
  readonly lessonId: string;
  readonly exerciseKey: string;
  /** What was shown, kept as the record. */
  readonly shown: string;
  readonly createdAt: Date;
}

/** One consistent read of a lesson's exercises and everything done with them. */
export interface ExerciseSnapshot {
  readonly declared: unknown[];
  readonly summaries: ReadonlyMap<string, AttemptSummary>;
  readonly hints: ReadonlyMap<string, readonly HintRecord[]>;
  readonly strain: Strain;
}

/**
 * `userId` first on every method — non-negotiable 1.
 */
export interface ExerciseRepository {
  /**
   * The lesson's `exercises` column, unvalidated. Null when the lesson is not the
   * user's — RLS makes that and "does not exist" the same answer.
   */
  declaredOn(userId: string, lessonId: string): Promise<unknown[] | null>;

  /** Per exercise key, for every key that has at least one attempt. */
  summaries(userId: string, lessonId: string): Promise<ReadonlyMap<string, AttemptSummary>>;

  record(userId: string, attempt: NewAttempt): Promise<void>;

  /** How the lesson landed (FR-D1), from its outcome, exercises, attempts and hints. */
  strainOf(userId: string, lessonId: string): Promise<Strain>;

  /** Null when the lesson is not the user's. */
  snapshot(userId: string, lessonId: string): Promise<ExerciseSnapshot | null>;

  /** At most once per exercise: a second opening adds nothing. */
  recordSolutionReveal(userId: string, reveal: NewSolutionReveal): Promise<void>;

  /** Every hint given on this lesson, per exercise key, oldest first. */
  hints(userId: string, lessonId: string): Promise<ReadonlyMap<string, readonly HintRecord[]>>;

  /**
   * The call's cost row, and the hint if one was given — in one transaction, so a
   * hint never exists without the bill for it and a bill is never lost because the
   * answer was empty.
   */
  recordHint(userId: string, hint: NewHint): Promise<void>;

  /** The review's cost row, and the attempt when a review came back — in one transaction. */
  recordReview(userId: string, review: NewReview): Promise<void>;

  /** A task's self-reported result, as an attempt graded by the learner (`graded_by = 'self'`). */
  recordReport(userId: string, report: NewReport): Promise<void>;
}
