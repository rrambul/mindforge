import {
  attemptPassed,
  describeScene,
  ExerciseDeclarationSchema,
  nextAllowedLevel,
  type ExerciseDeclaration,
  type RecordAttemptInput,
  type ReportTaskInput,
  type RequestHintInput,
  type RequestReviewInput,
  type Strain,
} from "@mindforge/core";
import { estimateCostUsd, pngBase64 } from "@mindforge/llm";
import { Inject, Injectable } from "@nestjs/common";

import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { LessonNotFound, LessonNotWritten } from "../../lessons/domain/errors.js";
import {
  LESSON_REPOSITORY,
  type LessonRepository,
} from "../../lessons/domain/lesson.repository.js";
import { TeachSpend } from "../../teach/application/teach-spend.js";
import { DailyBudgetExhausted } from "../../teach/domain/errors.js";
import {
  ExerciseKindMismatch,
  ExerciseNotFound,
  HintLevelLocked,
  HintNotGiven,
  ReviewNotGiven,
  SolutionUnavailable,
} from "../domain/errors.js";
import {
  EXERCISE_REPOSITORY,
  type AttemptSummary,
  type ExerciseRepository,
  type HintRecord,
} from "../domain/exercise.repository.js";
import { HINT_GENERATOR, type HintGenerator } from "../domain/hint-generator.port.js";
import { REVIEWER, type Reviewer } from "../domain/reviewer.port.js";
import { EXERCISES_CONFIG, type ExercisesConfig } from "./exercises.config.js";

export interface ExerciseWithAttempts {
  readonly exercise: ExerciseDeclaration;
  readonly attempts: AttemptSummary;
  /** Every hint given, oldest first. */
  readonly hints: readonly HintRecord[];
  /** The highest rung the learner may ask for next (`nextAllowedLevel`). */
  readonly nextHintLevel: number;
}

export interface LessonExercises {
  readonly lessonId: string;
  readonly runnerUrl: string;
  readonly pythonRunnerUrl: string;
  readonly strain: Strain;
  readonly exercises: readonly ExerciseWithAttempts[];
}

/** Nothing tried yet — which is a state, not a zero score. */
const UNTRIED: AttemptSummary = {
  count: 0,
  firstPassedAt: null,
  lastCode: null,
  lastPassed: null,
  lastAt: null,
  lastResults: null,
  lastScene: null,
};

/**
 * The column, re-validated on the way out.
 *
 * The reindexer only ever writes declarations the parser accepted, so this
 * normally drops nothing. It is here because the column is jsonb and a row
 * written around the reindexer — a hand fix, a restore — would otherwise reach
 * the SPA as an exercise with no tests to run.
 */
function valid(declared: readonly unknown[]): ExerciseDeclaration[] {
  return declared.flatMap((entry) => {
    const result = ExerciseDeclarationSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

function highestLevel(hints: readonly HintRecord[]): number | null {
  return hints.length === 0 ? null : Math.max(...hints.map((hint) => hint.level));
}

/**
 * A lesson's exercises and what you have done with each (FR-X2, FR-X6).
 *
 * A planned lesson has none rather than an error: there is no file, so nothing
 * declared any, and the reader already says "not written yet" on its own.
 */
@Injectable()
export class ListLessonExercises {
  constructor(
    @Inject(LESSON_REPOSITORY) private readonly lessons: LessonRepository,
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(EXERCISES_CONFIG) private readonly config: ExercisesConfig,
  ) {}

  async execute(userId: string, lessonId: string): Promise<LessonExercises> {
    const lesson = await this.lessons.findById(userId, lessonId);
    if (lesson === null) throw new LessonNotFound(lessonId);

    // One transaction for everything the list shows (review finding: it was four).
    const snapshot = await this.exercises.snapshot(userId, lessonId);
    const declared = snapshot?.declared ?? [];
    const summaries = snapshot?.summaries ?? new Map<string, AttemptSummary>();
    const hints = snapshot?.hints ?? new Map<string, readonly HintRecord[]>();
    const strain: Strain = snapshot?.strain ?? { verdict: null, unknown: "no-exercise" };

    return {
      lessonId,
      runnerUrl: this.config.runnerUrl,
      pythonRunnerUrl: this.config.pythonRunnerUrl,
      strain,
      exercises: valid(declared).map((exercise) => {
        const given = hints.get(exercise.key) ?? [];
        return {
          exercise,
          attempts: summaries.get(exercise.key) ?? UNTRIED,
          hints: given,
          nextHintLevel: nextAllowedLevel(highestLevel(given)),
        };
      }),
    };
  }
}

/**
 * One run of the tests (FR-X5).
 *
 * The server derives `passed` from the results rather than taking the client's
 * word for it, so "passed" has one rule (`attemptPassed`) — but the results
 * themselves are the browser's, and nothing here pretends otherwise. See
 * `RecordAttemptSchema` for why that is the honest arrangement.
 *
 * Every run is recorded, including errors and timeouts. "It took four tries and
 * the first two did not load" is exactly the signal Phase 3 reads; dropping the
 * failures would make every exercise look easier than it was.
 */
@Injectable()
export class RecordExerciseAttempt {
  constructor(
    @Inject(LESSON_REPOSITORY) private readonly lessons: LessonRepository,
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly list: ListLessonExercises,
  ) {}

  async execute(
    userId: string,
    lessonId: string,
    key: string,
    input: RecordAttemptInput,
  ): Promise<ExerciseWithAttempts> {
    const lesson = await this.lessons.findById(userId, lessonId);
    if (lesson === null) throw new LessonNotFound(lessonId);
    if (lesson.status === "planned") throw new LessonNotWritten(lessonId);

    const declared = valid((await this.exercises.declaredOn(userId, lessonId)) ?? []);
    const exercise = declared.find((candidate) => candidate.key === key);
    if (exercise === undefined) throw new ExerciseNotFound(lessonId, key);
    // A whiteboard is graded by review on the server, never by results a browser
    // reports: an attempt posted here for one would be a pass nobody checked.
    if (exercise.kind !== "code") throw new ExerciseKindMismatch(key, "code");

    await this.exercises.record(userId, {
      lessonId,
      exerciseKey: key,
      code: input.code,
      status: input.status,
      results: input.results,
      passed: attemptPassed(input.status, input.results),
      startedAt: input.startedAt === null ? null : new Date(input.startedAt),
      createdAt: this.clock.now(),
    });

    const { exercises } = await this.list.execute(userId, lessonId);
    // Present: it was found above, and nothing between the two reads removes it.
    return exercises.find((entry) => entry.exercise.key === key)!;
  }
}

/**
 * One rung of help (FR-H1–H4).
 *
 * Refusals come before the call, so nothing is spent on a request that was never
 * going to be answered: the lesson must be yours and written, the exercise must
 * exist, the rung must be at most one above the highest so far, and today's
 * teaching budget must not be spent. The budget is the same one lesson runs draw
 * on (FR-T8) — a hint is a model call billed to the same learner, and a second
 * ceiling would be a second number that could disagree with the meter.
 *
 * **The call is always billed**, answered or not. A refusal or an empty answer is
 * a `HintNotGiven` to the learner and still an `llm_calls` row: the tokens were
 * spent, and dropping the row would make the meter lie low (non-negotiable 9).
 */
@Injectable()
export class RequestExerciseHint {
  constructor(
    @Inject(LESSON_REPOSITORY) private readonly lessons: LessonRepository,
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(HINT_GENERATOR) private readonly generator: HintGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly spend: TeachSpend,
    private readonly list: ListLessonExercises,
  ) {}

  async execute(
    learner: {
      readonly userId: string;
      readonly timezone: string;
      readonly contentLanguage: string;
    },
    lessonId: string,
    key: string,
    input: RequestHintInput,
  ): Promise<ExerciseWithAttempts> {
    const { userId } = learner;
    const lesson = await this.lessons.findById(userId, lessonId);
    if (lesson === null) throw new LessonNotFound(lessonId);
    if (lesson.status === "planned") throw new LessonNotWritten(lessonId);

    const current = (await this.list.execute(userId, lessonId)).exercises.find(
      (entry) => entry.exercise.key === key,
    );
    if (current === undefined) throw new ExerciseNotFound(lessonId, key);
    const { exercise } = current;
    // Code only, for now: a whiteboard's feedback is its review.
    if (exercise.kind !== "code") throw new ExerciseKindMismatch(key, "code");
    if (input.level > current.nextHintLevel) {
      throw new HintLevelLocked(input.level, current.nextHintLevel);
    }

    const budget = await this.spend.today(userId, learner.timezone);
    // The same guard `TeachRuns.request` uses, so the two refusals cannot disagree.
    if (budget.exhausted && budget.capUsd !== null) {
      throw new DailyBudgetExhausted(budget.spentUsd, budget.capUsd);
    }

    const started = this.clock.now();
    const call = await this.generator.generate({
      exercise,
      hint: input,
      language: learner.contentLanguage,
    });
    const finished = this.clock.now();

    await this.exercises.recordHint(userId, {
      lessonId,
      exerciseKey: key,
      level: input.level,
      question: input.question,
      answer: call.answer.kind === "hint" ? call.answer.text : null,
      call: {
        model: call.model,
        ...call.usage,
        costUsd: priced(call.model, call.usage),
        latencyMs: finished.getTime() - started.getTime(),
        requestId: call.requestId,
        createdAt: finished,
      },
    });

    if (call.answer.kind !== "hint") throw new HintNotGiven(call.answer.kind);

    const { exercises } = await this.list.execute(userId, lessonId);
    // Present: it was found above, and nothing between the two reads removes it.
    return exercises.find((entry) => entry.exercise.key === key)!;
  }
}

/**
 * A drawn design, reviewed against its rubric (FR-X7–X9).
 *
 * The review **is** the attempt: its results are the rubric items, `passed` is
 * every item covered (`attemptPassed`, the same rule as tests), and the row says it
 * was graded by review. Unlike a code attempt, nothing here is the browser's word —
 * the server made the call and wrote down what came back.
 *
 * Ordered like a hint: every refusal before the call, and the call always billed,
 * whether or not a usable review came back.
 */
@Injectable()
export class RequestExerciseReview {
  constructor(
    @Inject(LESSON_REPOSITORY) private readonly lessons: LessonRepository,
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(REVIEWER) private readonly reviewer: Reviewer,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly spend: TeachSpend,
    private readonly list: ListLessonExercises,
  ) {}

  async execute(
    learner: {
      readonly userId: string;
      readonly timezone: string;
      readonly contentLanguage: string;
    },
    lessonId: string,
    key: string,
    input: RequestReviewInput,
  ): Promise<ExerciseWithAttempts> {
    const { userId } = learner;
    const lesson = await this.lessons.findById(userId, lessonId);
    if (lesson === null) throw new LessonNotFound(lessonId);
    if (lesson.status === "planned") throw new LessonNotWritten(lessonId);

    const exercise = valid((await this.exercises.declaredOn(userId, lessonId)) ?? []).find(
      (candidate) => candidate.key === key,
    );
    if (exercise === undefined) throw new ExerciseNotFound(lessonId, key);
    if (exercise.kind !== "whiteboard") throw new ExerciseKindMismatch(key, "whiteboard");

    const budget = await this.spend.today(userId, learner.timezone);
    if (budget.exhausted && budget.capUsd !== null) {
      throw new DailyBudgetExhausted(budget.spentUsd, budget.capUsd);
    }

    const elements = input.elements.filter((element) => element.isDeleted !== true);
    const description = describeScene(elements);

    const started = this.clock.now();
    const call = await this.reviewer.review({
      exercise,
      sceneDescription: description,
      imageBase64: pngBase64(input.image),
      language: learner.contentLanguage,
    });
    const finished = this.clock.now();

    const results =
      call.answer.kind === "review"
        ? call.answer.items.map((item) => ({
            name: item.item,
            passed: item.verdict === "covered",
            message: item.note,
            verdict: item.verdict,
          }))
        : null;

    await this.exercises.recordReview(userId, {
      lessonId,
      exerciseKey: key,
      description,
      scene: elements,
      review:
        results === null || call.answer.kind !== "review"
          ? null
          : {
              results,
              passed: attemptPassed("completed", results),
              feedback: call.answer.overall === "" ? null : call.answer.overall.slice(0, 1_000),
            },
      startedAt: input.startedAt === null ? null : new Date(input.startedAt),
      call: {
        model: call.model,
        ...call.usage,
        costUsd: priced(call.model, call.usage),
        latencyMs: finished.getTime() - started.getTime(),
        requestId: call.requestId,
        createdAt: finished,
      },
    });

    if (call.answer.kind !== "review") throw new ReviewNotGiven(call.answer.kind);

    const { exercises } = await this.list.execute(userId, lessonId);
    // Present: it was found above, and nothing between the two reads removes it.
    return exercises.find((entry) => entry.exercise.key === key)!;
  }
}

/**
 * "I ran it" — a `task` exercise's result, as the learner reports it.
 *
 * Recorded as their word (`graded_by = 'self'`), one result named for the command
 * they ran, so the summary, `lessonStrain` and adaptation read it like any attempt
 * while every screen that shows it says who decided. No start time is recorded —
 * the work happened in their terminal, out of the app's sight — so a task can land
 * too hard or in the zone, never too easy: that verdict needs a clock (FR-D1).
 *
 * No budget check and no bill: nothing is called.
 */
@Injectable()
export class ReportTaskResult {
  constructor(
    @Inject(LESSON_REPOSITORY) private readonly lessons: LessonRepository,
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly list: ListLessonExercises,
  ) {}

  async execute(
    userId: string,
    lessonId: string,
    key: string,
    input: ReportTaskInput,
  ): Promise<ExerciseWithAttempts> {
    const lesson = await this.lessons.findById(userId, lessonId);
    if (lesson === null) throw new LessonNotFound(lessonId);
    if (lesson.status === "planned") throw new LessonNotWritten(lessonId);

    const exercise = valid((await this.exercises.declaredOn(userId, lessonId)) ?? []).find(
      (candidate) => candidate.key === key,
    );
    if (exercise === undefined) throw new ExerciseNotFound(lessonId, key);
    if (exercise.kind !== "task") throw new ExerciseKindMismatch(key, "task");

    await this.exercises.recordReport(userId, {
      lessonId,
      exerciseKey: key,
      output: input.output ?? "",
      result: { name: exercise.command, passed: input.passed, message: null },
      createdAt: this.clock.now(),
    });

    const { exercises } = await this.list.execute(userId, lessonId);
    // Present: it was found above, and nothing between the two reads removes it.
    return exercises.find((entry) => entry.exercise.key === key)!;
  }
}

/**
 * Opening an exercise's reference solution (review finding #4).
 *
 * Recorded, because it is help: a learner who opens the solution, pastes it and
 * passes first try has not worked it out, and before this the lesson read "too
 * easy". Recorded as the top rung (`kind = 'solution'`, level 5), so
 * `lessonStrain` counts it exactly as it counts being shown the code.
 *
 * A whiteboard's reference design is withheld until its first review, and this
 * cannot be the way round that.
 */
@Injectable()
export class RevealSolution {
  constructor(
    @Inject(LESSON_REPOSITORY) private readonly lessons: LessonRepository,
    @Inject(EXERCISE_REPOSITORY) private readonly exercises: ExerciseRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly list: ListLessonExercises,
  ) {}

  async execute(userId: string, lessonId: string, key: string): Promise<ExerciseWithAttempts> {
    const lesson = await this.lessons.findById(userId, lessonId);
    if (lesson === null) throw new LessonNotFound(lessonId);
    if (lesson.status === "planned") throw new LessonNotWritten(lessonId);

    const current = (await this.list.execute(userId, lessonId)).exercises.find(
      (entry) => entry.exercise.key === key,
    );
    if (current === undefined) throw new ExerciseNotFound(lessonId, key);

    const { exercise } = current;
    if (exercise.solution === null) throw new SolutionUnavailable(key, "none");
    if (exercise.kind === "whiteboard" && current.attempts.count === 0) {
      throw new SolutionUnavailable(key, "not-yet");
    }

    await this.exercises.recordSolutionReveal(userId, {
      lessonId,
      exerciseKey: key,
      shown: exercise.solution,
      createdAt: this.clock.now(),
    });

    const { exercises } = await this.list.execute(userId, lessonId);
    // Present: it was found above, and nothing between the two reads removes it.
    return exercises.find((entry) => entry.exercise.key === key)!;
  }
}

/** Null for a model the pricing table does not know — unpriced, never free (FR-T9). */
function priced(model: string, usage: Parameters<typeof estimateCostUsd>[1]): number | null {
  try {
    return estimateCostUsd(model, usage);
  } catch {
    return null;
  }
}
