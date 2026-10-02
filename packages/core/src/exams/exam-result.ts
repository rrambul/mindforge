/**
 * How a module's exam went (FR-E6, `PLAN-EXAMS.md`).
 *
 * The one implementation, used by the curriculum screen and the reader. Derived on
 * read from the attempts, never stored — a retake that passes on Thursday revises
 * Tuesday's result, and a stored "failed" would go on saying otherwise.
 *
 * Three rules shape it:
 *
 * 1. **Passed means every item passed.** The same rule as a lesson exercise's tests
 *    and a whiteboard's rubric (`attemptPassed`). There is no pass mark to argue
 *    about, and "4 of 6" is reported as exactly that.
 * 2. **A self-reported pass is counted apart from a checked one.** A `task` item is
 *    run in the learner's own terminal and its pass is their word (FR-X10). It still
 *    counts toward passing — it is the only kind a compiled language has — but the
 *    result says how many of the passes nobody checked.
 * 3. **Nothing to pass is not a pass.** An exam with no items returns null, for the
 *    same reason `moduleProgress` does for a module with no lessons.
 */

/** `checked` — a test run or a review decided it. `self` — the learner reported it. */
export type ExamGrading = "checked" | "self";

export interface ExamAttemptFact {
  readonly createdAt: Date;
  readonly passed: boolean;
}

/** One exam item, as much of it as the result needs. */
export interface ExamItemFacts {
  readonly key: string;
  /** The slugs of the lessons this item examines. */
  readonly covers: readonly string[];
  readonly grading: ExamGrading;
  /** Every attempt, in any order. */
  readonly attempts: readonly ExamAttemptFact[];
}

export type ExamItemResult =
  | { readonly key: string; readonly state: "not-tried" }
  | { readonly key: string; readonly state: "failed"; readonly attempts: number }
  | {
      readonly key: string;
      readonly state: "passed";
      /** Attempts up to and including the first pass: 1 is a first-try pass. */
      readonly attemptsToPass: number;
      readonly passedAt: Date;
      readonly grading: ExamGrading;
    };

export interface ExamResult {
  readonly items: readonly ExamItemResult[];
  readonly total: number;
  readonly passedCount: number;
  /** Of `passedCount`, how many a test or a review checked. */
  readonly checkedPasses: number;
  /** Of `passedCount`, how many the learner reported. The two sum to `passedCount`. */
  readonly selfReportedPasses: number;
  /** Whether anything has been tried at all — "not sat yet" is not "failed". */
  readonly attempted: boolean;
  readonly passed: boolean;
  /** When the last item was first passed. Null until the exam is passed. */
  readonly passedAt: Date | null;
  /** The lessons the unpassed items cover, deduplicated, in item order. */
  readonly revisit: readonly string[];
}

export function examResult(items: readonly ExamItemFacts[]): ExamResult | null {
  if (items.length === 0) return null;

  const results = items.map(itemResult);
  const passed = results.filter((item) => item.state === "passed");
  const allPassed = passed.length === results.length;

  const revisit: string[] = [];
  items.forEach((item, index) => {
    if (results[index]!.state === "passed") return;
    for (const slug of item.covers) if (!revisit.includes(slug)) revisit.push(slug);
  });

  return {
    items: results,
    total: results.length,
    passedCount: passed.length,
    checkedPasses: passed.filter((item) => item.grading === "checked").length,
    selfReportedPasses: passed.filter((item) => item.grading === "self").length,
    attempted: results.some((item) => item.state !== "not-tried"),
    passed: allPassed,
    passedAt: allPassed
      ? new Date(Math.max(...passed.map((item) => item.passedAt.getTime())))
      : null,
    revisit,
  };
}

function itemResult(item: ExamItemFacts): ExamItemResult {
  if (item.attempts.length === 0) return { key: item.key, state: "not-tried" };

  const ordered = [...item.attempts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const first = ordered.findIndex((attempt) => attempt.passed);
  if (first === -1) return { key: item.key, state: "failed", attempts: ordered.length };

  return {
    key: item.key,
    state: "passed",
    attemptsToPass: first + 1,
    passedAt: ordered[first]!.createdAt,
    grading: item.grading,
  };
}

/**
 * When a module was finished, or null while it is not (FR-E7).
 *
 * Finished is every lesson completed **and** the exam passed — the exam is what ends
 * a module, so a module whose lessons are all done and whose exam is unwritten is not
 * finished, it is waiting for its exam. The instant is the later of the two, because
 * a plan revised after the exam can add a lesson the exam never saw, and finishing
 * that lesson is then what finishes the module.
 *
 * A module with no lessons has nothing to finish and is never finished.
 */
export function moduleFinishedAt(
  lessonCompletedAts: readonly (Date | null)[],
  examPassedAt: Date | null,
): Date | null {
  if (lessonCompletedAts.length === 0 || examPassedAt === null) return null;
  if (lessonCompletedAts.some((at) => at === null)) return null;

  const times = [...(lessonCompletedAts as readonly Date[]), examPassedAt].map((at) =>
    at.getTime(),
  );
  return new Date(Math.max(...times));
}

/** As much of a module as choosing what comes next needs. */
export interface ModuleStanding {
  readonly id: string;
  /** Has lessons, and every one is completed. False for a module with no lessons. */
  readonly lessonsDone: boolean;
  /** An exam file has been written for it. */
  readonly hasExam: boolean;
  /** `moduleFinishedAt` is not null: lessons done and exam passed. */
  readonly finished: boolean;
}

/**
 * The module whose exam the next teach run should write, or null (FR-E3).
 *
 * The first module, in the order given, whose lessons are all done and which has no
 * exam yet. Taken in curriculum order rather than "the module you just finished",
 * because a module finished before exams existed still owes one — and the button
 * means "the next thing", which for that module is its exam.
 */
export function moduleAwaitingExam(modules: readonly ModuleStanding[]): string | null {
  return modules.find((module) => module.lessonsDone && !module.hasExam)?.id ?? null;
}

/**
 * The module the learner is in — where the deadline prompt belongs (FR-U5).
 *
 * A module whose lessons are done but whose exam is not passed comes first: the
 * learner is not finished with it, and the next press of the button is about it.
 * Otherwise the module holding the next lesson. Null when neither exists, which is a
 * curriculum with nothing left to do or nothing planned.
 */
export function currentModule(
  modules: readonly ModuleStanding[],
  nextLessonModuleId: string | null,
): string | null {
  const examPending = modules.find((module) => module.lessonsDone && !module.finished);
  return examPending?.id ?? nextLessonModuleId;
}
