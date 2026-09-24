import type { ExerciseDeclaration, Strain, TestResult } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";

import type { HintCall, HintRequestInput, ReviewCall, ReviewRequestInput } from "@mindforge/llm";
import { FixedClock } from "../../../shared/time/clock.js";
import { LessonNotFound, LessonNotWritten } from "../../lessons/domain/errors.js";
import type { LessonRecord, LessonRepository } from "../../lessons/domain/lesson.repository.js";
import type { TeachSpend } from "../../teach/application/teach-spend.js";
import { DailyBudgetExhausted } from "../../teach/domain/errors.js";
import {
  ExerciseKindMismatch,
  ExerciseNotFound,
  HintLevelLocked,
  HintNotGiven,
  ReviewNotGiven,
} from "../domain/errors.js";
import type {
  AttemptSummary,
  ExerciseRepository,
  ExerciseSnapshot,
  HintRecord,
  NewAttempt,
  NewHint,
  NewReport,
  NewReview,
  NewSolutionReveal,
} from "../domain/exercise.repository.js";
import type { HintGenerator } from "../domain/hint-generator.port.js";
import type { Reviewer } from "../domain/reviewer.port.js";
import {
  ListLessonExercises,
  RecordExerciseAttempt,
  ReportTaskResult,
  RequestExerciseHint,
  RequestExerciseReview,
  RevealSolution,
} from "./exercises.use-cases.js";

/**
 * The exercise use cases.
 *
 * The two things worth a unit test are the two that would fail quietly: `passed`
 * taken from the client instead of derived, and an attempt recorded against an
 * exercise the lesson does not declare — which would be a history nobody can see,
 * because the panel only renders declared exercises.
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const LESSON = "88888888-8888-4888-8888-888888888888";
const NOW = new Date("2026-09-24T09:00:00Z");
const RUNNER = "https://lessons.example/runner";

const EXERCISE: ExerciseDeclaration = {
  key: "retry-backoff",
  kind: "code",
  language: "javascript",
  title: "Retry with backoff",
  prompt: "Write retry().",
  starter: "",
  tests: 'test("x", () => {});',
  solution: null,
  expectedMinutes: null,
};

const PASS: TestResult = { name: "a", passed: true, message: null };
const FAIL: TestResult = { name: "b", passed: false, message: "no" };

function lesson(over: Partial<LessonRecord> = {}): LessonRecord {
  return {
    id: LESSON,
    missionId: "m",
    trackId: null,
    moduleName: null,
    slug: "retries",
    title: "Retries",
    intent: null,
    status: "generated",
    difficulty: null,
    depth: null,
    seq: 1,
    storagePath: "lessons/0001-retries.html",
    workspaceKey: "resilience",
    completedAt: null,
    outcome: null,
    ...over,
  };
}

/** Keyed by user, so a use case that dropped `userId` fails here rather than in RLS. */
class InMemoryLessons implements LessonRepository {
  constructor(readonly rows: Map<string, LessonRecord>) {}

  findById(userId: string, id: string): Promise<LessonRecord | null> {
    return Promise.resolve(this.rows.get(`${userId}:${id}`) ?? null);
  }

  /** Exercises never write a completion: the reader owns that column. */
  setCompletion(): Promise<void> {
    return Promise.reject(new Error("exercises never write a completion"));
  }
}

class InMemoryExercises implements ExerciseRepository {
  readonly recorded: NewAttempt[] = [];
  readonly hinted: NewHint[] = [];

  constructor(readonly declared: Map<string, unknown[]>) {}

  declaredOn(userId: string, lessonId: string): Promise<unknown[] | null> {
    return Promise.resolve(this.declared.get(`${userId}:${lessonId}`) ?? null);
  }

  summaries(): Promise<ReadonlyMap<string, AttemptSummary>> {
    const byKey = new Map<string, AttemptSummary>();
    for (const attempt of this.recorded) {
      const previous = byKey.get(attempt.exerciseKey);
      byKey.set(attempt.exerciseKey, {
        count: (previous?.count ?? 0) + 1,
        firstPassedAt: previous?.firstPassedAt ?? (attempt.passed ? attempt.createdAt : null),
        lastCode: attempt.code,
        lastPassed: attempt.passed,
        lastAt: attempt.createdAt,
        lastResults: attempt.results,
        lastScene: null,
      });
    }
    return Promise.resolve(byKey);
  }

  record(_userId: string, attempt: NewAttempt): Promise<void> {
    this.recorded.push(attempt);
    return Promise.resolve();
  }

  strain: Strain = { verdict: null, unknown: "in-progress" };
  readonly revealed: NewSolutionReveal[] = [];

  async snapshot(userId: string, lessonId: string): Promise<ExerciseSnapshot | null> {
    const declared = await this.declaredOn(userId, lessonId);
    if (declared === null) return null;
    const hints = new Map(await this.hints());
    for (const reveal of this.revealed) {
      hints.set(reveal.exerciseKey, [
        ...(hints.get(reveal.exerciseKey) ?? []),
        {
          kind: "solution",
          level: 5,
          question: null,
          answer: reveal.shown,
          createdAt: reveal.createdAt,
        },
      ]);
    }
    return { declared, summaries: await this.summaries(), hints, strain: this.strain };
  }

  recordSolutionReveal(_userId: string, reveal: NewSolutionReveal): Promise<void> {
    if (!this.revealed.some((r) => r.exerciseKey === reveal.exerciseKey))
      this.revealed.push(reveal);
    return Promise.resolve();
  }

  strainOf(): Promise<Strain> {
    return Promise.resolve(this.strain);
  }

  hints(): Promise<ReadonlyMap<string, readonly HintRecord[]>> {
    const byKey = new Map<string, HintRecord[]>();
    for (const hint of this.hinted) {
      if (hint.answer === null) continue;
      const list = byKey.get(hint.exerciseKey) ?? [];
      list.push({
        kind: "hint",
        level: hint.level,
        question: hint.question,
        answer: hint.answer,
        createdAt: hint.call.createdAt,
      });
      byKey.set(hint.exerciseKey, list);
    }
    return Promise.resolve(byKey);
  }

  recordHint(_userId: string, hint: NewHint): Promise<void> {
    this.hinted.push(hint);
    return Promise.resolve();
  }

  readonly reported: NewReport[] = [];

  recordReport(_userId: string, report: NewReport): Promise<void> {
    this.reported.push(report);
    this.recorded.push({
      lessonId: report.lessonId,
      exerciseKey: report.exerciseKey,
      code: report.output,
      status: "completed",
      results: [report.result],
      passed: report.result.passed,
      startedAt: null,
      createdAt: report.createdAt,
    });
    return Promise.resolve();
  }

  readonly reviewed: NewReview[] = [];

  recordReview(_userId: string, review: NewReview): Promise<void> {
    this.reviewed.push(review);
    if (review.review !== null) {
      this.recorded.push({
        lessonId: review.lessonId,
        exerciseKey: review.exerciseKey,
        code: review.description,
        status: "completed",
        results: review.review.results,
        passed: review.review.passed,
        startedAt: review.startedAt,
        createdAt: review.call.createdAt,
      });
    }
    return Promise.resolve();
  }
}

/** Records what it was asked, and answers with whatever the test set. */
class StubHints implements HintGenerator {
  readonly asked: HintRequestInput[] = [];
  answer: HintCall["answer"] = { kind: "hint", text: "Which way is the list sorted?" };
  model = "claude-opus-5";

  generate(input: HintRequestInput): Promise<HintCall> {
    this.asked.push(input);
    return Promise.resolve({
      answer: this.answer,
      model: this.model,
      usage: { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
      requestId: "req_1",
    });
  }
}

function spendOf(exhausted: boolean): TeachSpend {
  return {
    today: () =>
      Promise.resolve({
        spentUsd: exhausted ? 15 : 1,
        capUsd: 15,
        remainingUsd: exhausted ? 0 : 14,
        fraction: exhausted ? 1 : 1 / 15,
        exhausted,
        unpricedCalls: 0,
        atLeast: false,
        day: "2026-09-24",
      }),
  } as unknown as TeachSpend;
}

let lessons: InMemoryLessons;
let exercises: InMemoryExercises;
let generator: StubHints;

function build({ exhausted = false }: { exhausted?: boolean } = {}) {
  const clock = new FixedClock(NOW);
  const list = new ListLessonExercises(lessons, exercises, {
    runnerUrl: RUNNER,
    pythonRunnerUrl: `${RUNNER}/python`,
  });
  return {
    list,
    record: new RecordExerciseAttempt(lessons, exercises, clock, list),
    hint: new RequestExerciseHint(lessons, exercises, generator, clock, spendOf(exhausted), list),
  };
}

beforeEach(() => {
  lessons = new InMemoryLessons(new Map([[`${ALICE}:${LESSON}`, lesson()]]));
  exercises = new InMemoryExercises(new Map([[`${ALICE}:${LESSON}`, [EXERCISE]]]));
  generator = new StubHints();
});

describe("ListLessonExercises", () => {
  it("lists what the lesson declares, untried, with the runner's URL", async () => {
    const listed = await build().list.execute(ALICE, LESSON);

    expect(listed.runnerUrl).toBe(RUNNER);
    expect(listed.pythonRunnerUrl).toBe(`${RUNNER}/python`);
    expect(listed.exercises).toEqual([
      {
        exercise: EXERCISE,
        attempts: {
          count: 0,
          firstPassedAt: null,
          lastCode: null,
          lastPassed: null,
          lastAt: null,
          lastResults: null,
          lastScene: null,
        },
        hints: [],
        nextHintLevel: 1,
      },
    ]);
  });

  it("drops a stored entry the contract refuses, rather than serving it", async () => {
    exercises.declared.set(`${ALICE}:${LESSON}`, [{ key: "half-written" }, EXERCISE]);

    const listed = await build().list.execute(ALICE, LESSON);

    expect(listed.exercises.map((e) => e.exercise.key)).toEqual(["retry-backoff"]);
  });

  it("treats a missing column read as no exercises", async () => {
    exercises.declared.clear();

    expect((await build().list.execute(ALICE, LESSON)).exercises).toEqual([]);
  });

  it("refuses a lesson that is not yours", async () => {
    await expect(build().list.execute(BOB, LESSON)).rejects.toBeInstanceOf(LessonNotFound);
  });
});

describe("RecordExerciseAttempt", () => {
  const input = (
    results: TestResult[],
    status: "completed" | "error" | "timeout" = "completed",
  ) => ({
    code: "// mine",
    status,
    results,
    startedAt: "2026-09-24T08:50:00.000Z",
  });

  it("derives `passed` from the results, never from the client", async () => {
    await build().record.execute(ALICE, LESSON, EXERCISE.key, input([PASS, FAIL]));
    await build().record.execute(ALICE, LESSON, EXERCISE.key, input([PASS]));
    await build().record.execute(ALICE, LESSON, EXERCISE.key, input([PASS], "timeout"));

    expect(exercises.recorded.map((a) => a.passed)).toEqual([false, true, false]);
  });

  it("stamps the attempt with the server's clock and keeps the learner's start", async () => {
    await build().record.execute(ALICE, LESSON, EXERCISE.key, input([PASS]));

    expect(exercises.recorded[0]).toMatchObject({
      createdAt: NOW,
      startedAt: new Date("2026-09-24T08:50:00.000Z"),
      lessonId: LESSON,
      exerciseKey: EXERCISE.key,
    });
  });

  it("returns the exercise with its summary moved on", async () => {
    const result = await build().record.execute(ALICE, LESSON, EXERCISE.key, input([PASS]));

    expect(result.attempts).toMatchObject({ count: 1, firstPassedAt: NOW, lastPassed: true });
  });

  it("records a start of null when the learner never edited the starter", async () => {
    await build().record.execute(ALICE, LESSON, EXERCISE.key, { ...input([]), startedAt: null });

    expect(exercises.recorded[0]!.startedAt).toBeNull();
  });

  it("refuses a key the lesson does not declare", async () => {
    await expect(
      build().record.execute(ALICE, LESSON, "jitter", input([PASS])),
    ).rejects.toBeInstanceOf(ExerciseNotFound);
    expect(exercises.recorded).toEqual([]);
  });

  it("refuses a planned lesson", async () => {
    lessons.rows.set(`${ALICE}:${LESSON}`, lesson({ status: "planned" }));

    await expect(
      build().record.execute(ALICE, LESSON, EXERCISE.key, input([PASS])),
    ).rejects.toBeInstanceOf(LessonNotWritten);
  });

  it("refuses a lesson that is not yours", async () => {
    await expect(
      build().record.execute(BOB, LESSON, EXERCISE.key, input([PASS])),
    ).rejects.toBeInstanceOf(LessonNotFound);
  });
});

describe("RequestExerciseHint", () => {
  const ALICE_CTX = { userId: ALICE, timezone: "UTC", contentLanguage: "pt-BR" };
  const ask = (level: number, question: string | null = null) => ({
    level,
    code: "// stuck",
    lastRun: null,
    question,
  });

  it("asks at the first rung, in the learner's content language, and records the hint", async () => {
    const result = await build().hint.execute(ALICE_CTX, LESSON, EXERCISE.key, ask(1));

    expect(generator.asked[0]).toMatchObject({ exercise: EXERCISE, language: "pt-BR" });
    expect(result.hints).toEqual([
      {
        kind: "hint",
        level: 1,
        question: null,
        answer: "Which way is the list sorted?",
        createdAt: NOW,
      },
    ]);
    expect(result.nextHintLevel).toBe(2);
  });

  it("climbs one rung at a time, and never straight to the code", async () => {
    await expect(
      build().hint.execute(ALICE_CTX, LESSON, EXERCISE.key, ask(5)),
    ).rejects.toBeInstanceOf(HintLevelLocked);
    expect(generator.asked).toEqual([]);

    await build().hint.execute(ALICE_CTX, LESSON, EXERCISE.key, ask(1));
    await build().hint.execute(ALICE_CTX, LESSON, EXERCISE.key, ask(2));
    // Asking again at a rung already reached is "say it differently", not a climb.
    const again = await build().hint.execute(ALICE_CTX, LESSON, EXERCISE.key, ask(2, "why?"));

    expect(again.hints.map((h) => h.level)).toEqual([1, 2, 2]);
    expect(again.nextHintLevel).toBe(3);
  });

  it("bills the call with its tokens, its price and its model", async () => {
    await build().hint.execute(ALICE_CTX, LESSON, EXERCISE.key, ask(1));

    expect(exercises.hinted[0]!.call).toMatchObject({
      model: "claude-opus-5",
      inputTokens: 1_000,
      outputTokens: 100,
      requestId: "req_1",
    });
    // $5/M in and $25/M out on Opus 5: 0.005 + 0.0025.
    expect(exercises.hinted[0]!.call.costUsd).toBeCloseTo(0.0075, 6);
  });

  it("records an unpriced model as unpriced, never as free", async () => {
    generator.model = "claude-something-new";

    await build().hint.execute(ALICE_CTX, LESSON, EXERCISE.key, ask(1));

    expect(exercises.hinted[0]!.call.costUsd).toBeNull();
  });

  it("still bills a call that produced no hint, and says it produced none", async () => {
    generator.answer = { kind: "refused" };

    await expect(
      build().hint.execute(ALICE_CTX, LESSON, EXERCISE.key, ask(1)),
    ).rejects.toBeInstanceOf(HintNotGiven);
    expect(exercises.hinted).toHaveLength(1);
    expect(exercises.hinted[0]!.answer).toBeNull();
  });

  it("refuses before calling when today's budget is spent", async () => {
    await expect(
      build({ exhausted: true }).hint.execute(ALICE_CTX, LESSON, EXERCISE.key, ask(1)),
    ).rejects.toBeInstanceOf(DailyBudgetExhausted);
    expect(generator.asked).toEqual([]);
    expect(exercises.hinted).toEqual([]);
  });

  it("refuses an exercise the lesson does not declare, and a lesson that is not yours", async () => {
    await expect(build().hint.execute(ALICE_CTX, LESSON, "jitter", ask(1))).rejects.toBeInstanceOf(
      ExerciseNotFound,
    );
    await expect(
      build().hint.execute({ ...ALICE_CTX, userId: BOB }, LESSON, EXERCISE.key, ask(1)),
    ).rejects.toBeInstanceOf(LessonNotFound);
    expect(generator.asked).toEqual([]);
  });
});

describe("whiteboard exercises", () => {
  const BOARD = {
    key: "url-shortener",
    kind: "whiteboard" as const,
    title: "Design a URL shortener",
    prompt: "Draw the read and write paths.",
    rubric: ["Separates reads from writes", "Caches hot redirects"],
    solution: "Two paths; a cache on reads.",
    expectedMinutes: 20,
  };
  const CTX = { userId: ALICE, timezone: "UTC", contentLanguage: "en" };
  const SCENE = [
    { id: "a", type: "rectangle" },
    { id: "t", type: "text", containerId: "a", text: "API" },
    { id: "gone", type: "rectangle", isDeleted: true },
  ];

  class StubReviewer implements Reviewer {
    readonly asked: ReviewRequestInput[] = [];
    answer: ReviewCall["answer"] = {
      kind: "review",
      items: [
        { item: BOARD.rubric[0]!, verdict: "covered", note: "Two services." },
        { item: BOARD.rubric[1]!, verdict: "partly", note: "A cache, but not on the read path." },
      ],
      overall: "Clear split; the cache is not wired in.",
    };

    review(input: ReviewRequestInput): Promise<ReviewCall> {
      this.asked.push(input);
      return Promise.resolve({
        answer: this.answer,
        model: "claude-opus-5",
        usage: { inputTokens: 3_000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 },
        requestId: "req_rev",
      });
    }
  }

  let reviewer: StubReviewer;
  const review = (exhausted = false) =>
    new RequestExerciseReview(
      lessons,
      exercises,
      reviewer,
      new FixedClock(NOW),
      spendOf(exhausted),
      new ListLessonExercises(lessons, exercises, {
        runnerUrl: RUNNER,
        pythonRunnerUrl: `${RUNNER}/python`,
      }),
    );
  const submit = { elements: SCENE, image: "data:image/png;base64,AAAA", startedAt: null };

  beforeEach(() => {
    exercises.declared.set(`${ALICE}:${LESSON}`, [EXERCISE, BOARD]);
    reviewer = new StubReviewer();
  });

  it("reads the live drawing, as an image and as text, in the learner's language", async () => {
    await review().execute(CTX, LESSON, BOARD.key, submit);

    expect(reviewer.asked[0]).toMatchObject({ imageBase64: "AAAA", language: "en" });
    expect(reviewer.asked[0]!.sceneDescription).toContain("- rectangle: API");
    // The deleted shape is neither described nor kept.
    expect(exercises.reviewed[0]!.scene.map((e) => e.id)).toEqual(["a", "t"]);
  });

  it("records the review as an attempt whose results are the rubric", async () => {
    const result = await review().execute(CTX, LESSON, BOARD.key, submit);

    expect(exercises.reviewed[0]!.review).toEqual({
      results: [
        { name: BOARD.rubric[0], passed: true, message: "Two services.", verdict: "covered" },
        {
          name: BOARD.rubric[1],
          passed: false,
          message: "A cache, but not on the read path.",
          verdict: "partly",
        },
      ],
      // Partly is not covered, so the design has not passed.
      passed: false,
      feedback: "Clear split; the cache is not wired in.",
    });
    expect(result.attempts.count).toBe(1);
  });

  it("passes only when every rubric item is covered", async () => {
    reviewer.answer = {
      kind: "review",
      items: BOARD.rubric.map((item) => ({ item, verdict: "covered" as const, note: "yes" })),
      overall: "",
    };

    await review().execute(CTX, LESSON, BOARD.key, submit);

    expect(exercises.reviewed[0]!.review).toMatchObject({ passed: true, feedback: null });
  });

  it("bills a review that did not come back, and records no attempt for it", async () => {
    reviewer.answer = { kind: "empty" };

    await expect(review().execute(CTX, LESSON, BOARD.key, submit)).rejects.toBeInstanceOf(
      ReviewNotGiven,
    );
    expect(exercises.reviewed[0]).toMatchObject({ review: null, call: { requestId: "req_rev" } });
    expect(exercises.recorded).toEqual([]);
  });

  it("refuses before calling when today's budget is spent", async () => {
    await expect(review(true).execute(CTX, LESSON, BOARD.key, submit)).rejects.toBeInstanceOf(
      DailyBudgetExhausted,
    );
    expect(reviewer.asked).toEqual([]);
  });

  it("will not review a code exercise, run a whiteboard, or give it hints", async () => {
    await expect(review().execute(CTX, LESSON, EXERCISE.key, submit)).rejects.toBeInstanceOf(
      ExerciseKindMismatch,
    );
    await expect(
      build().record.execute(ALICE, LESSON, BOARD.key, {
        code: "x",
        status: "completed",
        results: [],
        startedAt: null,
      }),
    ).rejects.toBeInstanceOf(ExerciseKindMismatch);
    await expect(
      build().hint.execute(CTX, LESSON, BOARD.key, {
        level: 1,
        code: "",
        lastRun: null,
        question: null,
      }),
    ).rejects.toBeInstanceOf(ExerciseKindMismatch);
    expect(reviewer.asked).toEqual([]);
  });
});

describe("task exercises — run on the learner's machine", () => {
  const TASK = {
    key: "gen-counter",
    kind: "task" as const,
    title: "A counter as a GenServer",
    prompt: "Write Counter with increment/1 and value/1.",
    language: "elixir",
    files: [
      { path: "lib/counter.ex", contents: "defmodule Counter do\nend\n" },
      { path: "test/counter_test.exs", contents: "defmodule CounterTest do\nend\n" },
    ],
    command: "mix test",
    solution: null,
    expectedMinutes: 15,
  };
  const report = () =>
    new ReportTaskResult(
      lessons,
      exercises,
      new FixedClock(NOW),
      new ListLessonExercises(lessons, exercises, {
        runnerUrl: RUNNER,
        pythonRunnerUrl: `${RUNNER}/python`,
      }),
    );

  beforeEach(() => {
    exercises.declared.set(`${ALICE}:${LESSON}`, [EXERCISE, TASK]);
  });

  it("records the learner's word as one result, named for the command they ran", async () => {
    const result = await report().execute(ALICE, LESSON, TASK.key, {
      passed: false,
      output: "1 test, 1 failure",
    });

    expect(exercises.reported[0]).toEqual({
      lessonId: LESSON,
      exerciseKey: TASK.key,
      output: "1 test, 1 failure",
      result: { name: "mix test", passed: false, message: null },
      createdAt: NOW,
    });
    expect(result.attempts).toMatchObject({ count: 1, lastPassed: false });
  });

  it("keeps an empty output as empty, not as a missing report", async () => {
    await report().execute(ALICE, LESSON, TASK.key, { passed: true, output: null });

    expect(exercises.reported[0]).toMatchObject({ output: "", result: { passed: true } });
  });

  it("refuses a report on anything but a task, and every other kind's endpoint refuses a task", async () => {
    await expect(
      report().execute(ALICE, LESSON, EXERCISE.key, { passed: true, output: null }),
    ).rejects.toBeInstanceOf(ExerciseKindMismatch);
    await expect(
      build().record.execute(ALICE, LESSON, TASK.key, {
        code: "x",
        status: "completed",
        results: [],
        startedAt: null,
      }),
    ).rejects.toBeInstanceOf(ExerciseKindMismatch);
    await expect(
      build().hint.execute(
        { userId: ALICE, timezone: "UTC", contentLanguage: "en" },
        LESSON,
        TASK.key,
        {
          level: 1,
          code: "",
          lastRun: null,
          question: null,
        },
      ),
    ).rejects.toBeInstanceOf(ExerciseKindMismatch);
  });

  it("refuses a lesson that is not yours, or not written", async () => {
    await expect(
      report().execute(BOB, LESSON, TASK.key, { passed: true, output: null }),
    ).rejects.toBeInstanceOf(LessonNotFound);
    lessons.rows.set(`${ALICE}:${LESSON}`, lesson({ status: "planned" }));
    await expect(
      report().execute(ALICE, LESSON, TASK.key, { passed: true, output: null }),
    ).rejects.toBeInstanceOf(LessonNotWritten);
  });
});

describe("RevealSolution", () => {
  const reveal = () =>
    new RevealSolution(
      lessons,
      exercises,
      new FixedClock(NOW),
      new ListLessonExercises(lessons, exercises, {
        runnerUrl: RUNNER,
        pythonRunnerUrl: `${RUNNER}/python`,
      }),
    );

  it("records opening the solution as the top rung, once", async () => {
    exercises.declared.set(`${ALICE}:${LESSON}`, [{ ...EXERCISE, solution: "answer" }]);

    await reveal().execute(ALICE, LESSON, EXERCISE.key);
    const again = await reveal().execute(ALICE, LESSON, EXERCISE.key);

    expect(exercises.revealed).toHaveLength(1);
    expect(again.hints).toMatchObject([{ kind: "solution", level: 5, answer: "answer" }]);
  });

  it("refuses an exercise with no solution", async () => {
    await expect(reveal().execute(ALICE, LESSON, EXERCISE.key)).rejects.toMatchObject({
      detailKey: "error.exercise.no_solution",
    });
  });

  it("refuses a whiteboard's reference design before its first review", async () => {
    exercises.declared.set(`${ALICE}:${LESSON}`, [
      {
        key: "board",
        kind: "whiteboard",
        title: "B",
        prompt: "p",
        rubric: ["a", "b"],
        solution: "design",
        expectedMinutes: null,
      },
    ]);

    await expect(reveal().execute(ALICE, LESSON, "board")).rejects.toMatchObject({
      detailKey: "error.exercise.solution_after_review",
    });
    expect(exercises.revealed).toEqual([]);
  });
});
