import { z } from "zod";

/**
 * Exercises — something the learner does inside a lesson (FR-X1, `PLAN-HANDS-ON.md` Phase 1).
 *
 * Three contracts live here, because three separate parties have to agree on them:
 *
 * 1. **The declaration** — what the agent writes into the lesson file, inside
 *    `<script type="application/vnd.mindforge.exercise+json">`. The workspace
 *    parser validates it and the reindexer stores it on the lesson's row.
 * 2. **The runner protocol** — what the app sends to the sandboxed runner frame on
 *    the lessons origin, and what comes back. Both ends parse, because the runner
 *    executes agent-written tests and a message from it is untrusted data.
 * 3. **Recording an attempt** — what the SPA posts after a run.
 *
 * The response views are in `wire.ts` with every other response.
 */

/** The `type` attribute that marks an exercise block. A non-JS type, so the browser never runs it. */
export const EXERCISE_SCRIPT_TYPE = "application/vnd.mindforge.exercise+json";

/**
 * `code` runs the learner's code against tests in the browser (Phase 1).
 * `whiteboard` is a design drawn on a canvas and reviewed against a rubric
 * (Phase 4). `task` is code the learner writes and runs **on their own machine** —
 * for the languages the browser cannot run, Elixir, Rust, Go — and reports back.
 */
export const EXERCISE_KINDS = ["code", "whiteboard", "task"] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

/**
 * What the runner can execute. All three run in the browser: TypeScript is
 * transpiled in the runner frame, never type-checked — the tests are the check —
 * and Python runs on Pyodide (CPython compiled to WebAssembly), standard library
 * only (Phase 5).
 */
export const EXERCISE_LANGUAGES = ["javascript", "typescript", "python"] as const;
export type ExerciseLanguage = (typeof EXERCISE_LANGUAGES)[number];

/**
 * A key the lesson chooses, stable across regenerations of the same file. It is
 * what attempts are recorded against, so it is kept to characters that are safe
 * in a URL path segment.
 */
export const ExerciseKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "a lowercase dash-case key");

/** The size cap on any one piece of code, in characters: well past any exercise, well short of abuse. */
export const EXERCISE_CODE_MAX = 50_000;

const Code = z.string().max(EXERCISE_CODE_MAX);

/** What every kind of exercise has. */
const ExerciseBase = z.object({
  key: ExerciseKeySchema,
  title: z.string().min(1).max(200),
  /** Plain text. The lesson carries the explanation; this is the task. */
  prompt: z.string().min(1).max(4_000),
  /** What the lesson expects this to take. Phase 3 compares against it; absent is not zero. */
  expectedMinutes: z.number().int().min(1).max(120).nullable().default(null),
});

export const CodeExerciseSchema = ExerciseBase.extend({
  kind: z.literal("code"),
  language: z.enum(EXERCISE_LANGUAGES),
  /** What the editor opens with. Empty is legal: "write it from scratch". */
  starter: Code,
  /**
   * Test code, using the runner's `test` / `expect`, and importing the learner's
   * code from `./solution`. Required and non-empty: an exercise with no tests has
   * no feedback loop, which is the thing this whole feature exists to add.
   */
  tests: Code.min(1),
  /** A reference solution, shown only when the learner asks. Grounds Phase 2's hints. */
  solution: Code.nullable().default(null),
});
export type CodeExercise = z.infer<typeof CodeExerciseSchema>;

/** One rubric line: something a good answer covers, stated so it can be checked. */
export const RubricItemSchema = z.string().trim().min(1).max(300);

/**
 * A design drawn on a canvas and reviewed against a rubric (FR-X7–X9, Phase 4).
 *
 * The rubric is the grading contract — the things a good answer covers, each one
 * checkable on its own ("puts a queue between the API and the workers") rather than
 * a quality ("is well designed"). It is **hidden until the first review**, because a
 * checklist shown up front is the answer shown up front.
 */
export const WhiteboardExerciseSchema = ExerciseBase.extend({
  kind: z.literal("whiteboard"),
  rubric: z.array(RubricItemSchema).min(2).max(10),
  /** A reference design in words, shown only when asked for, after a review. */
  solution: z.string().max(8_000).nullable().default(null),
});
export type WhiteboardExercise = z.infer<typeof WhiteboardExerciseSchema>;

/**
 * A relative path inside the learner's project: `lib/clock.ex`, `test/clock_test.exs`.
 * No leading slash, no `..`, no backslashes — it is shown to be created by hand,
 * and a path that climbs out of the project is one nobody should be told to write.
 */
export const TaskFilePathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+$/u,
    "a relative path inside the project",
  );

/**
 * Code the learner writes and runs in their own terminal (the `task` kind).
 *
 * The lesson gives them everything to set it up — every file, in full, and the one
 * command that runs the tests — because the app cannot run it for them. What the
 * app records is what they report back, and it says so: a task's pass is
 * self-reported (`graded_by = 'self'`), never presented as one a test run checked.
 */
export const TaskExerciseSchema = ExerciseBase.extend({
  kind: z.literal("task"),
  /** What it is written in, as a label: `elixir`, `rust`, `go`. Lowercase, free-form. */
  language: z
    .string()
    .min(1)
    .max(30)
    .regex(/^[a-z0-9+#.-]+$/u, "a lowercase language name"),
  /** Every file to create, starter code and tests alike, in the order to create them. */
  files: z
    .array(z.object({ path: TaskFilePathSchema, contents: Code }))
    .min(1)
    .max(12),
  /** The one command that runs the tests, from the project root: `mix test`. */
  command: z.string().min(1).max(300),
  /** A reference solution, shown only when asked for. */
  solution: Code.nullable().default(null),
});
export type TaskExercise = z.infer<typeof TaskExerciseSchema>;

export const ExerciseDeclarationSchema = z.discriminatedUnion("kind", [
  CodeExerciseSchema,
  WhiteboardExerciseSchema,
  TaskExerciseSchema,
]);
export type ExerciseDeclaration = z.infer<typeof ExerciseDeclarationSchema>;

// ============================================================================
// The runner protocol — app ⇄ sandboxed runner frame, over `postMessage`
// ============================================================================

/** How long one run may take before the runner kills its worker. */
export const RUNNER_TIMEOUT_MS = 5_000;

/**
 * How long the Python runtime may take to start, **separately** from a run.
 *
 * Pyodide is about 13 MB and takes seconds to start the first time, and counting
 * that against a learner's five seconds would time out correct code. So the clock
 * for a run starts once Python is ready, and this bounds the start instead. A
 * warm-up message (`RunnerWarmSchema`) lets the app start it before the first run.
 */
export const PYTHON_LOAD_TIMEOUT_MS = 60_000;

/** Start a language's runtime ahead of the first run. Only Python has one to start. */
export const RunnerWarmSchema = z.object({
  type: z.literal("mindforge:warm"),
  language: z.literal("python"),
});
export type RunnerWarm = z.infer<typeof RunnerWarmSchema>;

export const RunnerRequestSchema = z.object({
  type: z.literal("mindforge:run"),
  /** Echoed back, so a slow answer to an old run is never shown as the answer to a new one. */
  runId: z.string().min(1).max(100),
  language: z.enum(EXERCISE_LANGUAGES),
  code: Code,
  tests: Code,
});
export type RunnerRequest = z.infer<typeof RunnerRequestSchema>;

/** How a reviewer judged one rubric item. Only `covered` counts as passed. */
export const REVIEW_VERDICTS = ["covered", "partly", "missing"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const TestResultSchema = z.object({
  name: z.string().max(500),
  passed: z.boolean(),
  /** The failure's message — or, for a reviewed item, the reviewer's note. Null on a plain pass. */
  message: z.string().max(4_000).nullable(),
  /**
   * Set only on a whiteboard review, where "not passed" has two shapes the learner
   * should see apart: partly there, or missing. Absent on a test result, which is
   * pass or fail and nothing between.
   */
  verdict: z.enum(REVIEW_VERDICTS).optional(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

/**
 * What a run can end as.
 *
 * - `completed` — the tests ran; each result says how it went.
 * - `error` — the code or the tests could not be loaded at all: a syntax error, a
 *   throw at the top level, a missing export. `results` is empty and `message`
 *   says why. This is the learner's most common state and must not read as a crash.
 * - `timeout` — nothing came back within `RUNNER_TIMEOUT_MS`; the worker was killed.
 */
export const RUN_STATUSES = ["completed", "error", "timeout"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Why a run did not complete, as a key the app translates (§5.2).
 *
 * The runner used to answer in English sentences, which a pt-BR learner read in
 * English and `check:i18n` could not see. Now the framing is a key and the app
 * words it; `message` carries only the raw detail beneath it — the compiler's or
 * the interpreter's own text, which is the learner's to read as-is, like a stack
 * trace.
 */
export const RUN_REASONS = [
  /** The learner's code did not parse or compile. */
  "code-syntax",
  /** The tests did not parse or compile — the lesson's bug, not the learner's. */
  "tests-syntax",
  /** The learner's code threw while loading. */
  "code-load",
  /** The tests threw while loading — a missing export, usually. */
  "tests-load",
  /** The tests imported something other than `./solution`. */
  "import-refused",
  /** The tests defined nothing to run. */
  "nothing-registered",
  /** More tests than one run reports; the lesson should have fewer. */
  "too-many-tests",
  /** Nothing came back in time. */
  "timeout",
  /** The worker died without answering. */
  "crashed",
  /** Python did not start. */
  "runtime-unavailable",
] as const;
export type RunReason = (typeof RUN_REASONS)[number];

/** The most results one run reports. A lesson's exercise has three to six; this is a ceiling, not a target. */
export const RESULTS_MAX = 200;

export const RunnerResponseSchema = z.object({
  type: z.literal("mindforge:result"),
  runId: z.string().min(1).max(100),
  status: z.enum(RUN_STATUSES),
  /** Why it did not complete. Null on `completed`. */
  reason: z.enum(RUN_REASONS).nullable().default(null),
  results: z.array(TestResultSchema).max(RESULTS_MAX),
  /** The raw detail under `reason` — compiler or interpreter output — or null. Never a sentence of ours. */
  message: z.string().max(4_000).nullable(),
  /** Captured `console.log` lines, capped, for debugging. */
  logs: z.array(z.string().max(1_000)).max(100),
});
export type RunnerResponse = z.infer<typeof RunnerResponseSchema>;

/** The runner says it is listening. Sent once on load, so the app never posts into a frame that is not ready. */
export const RunnerReadySchema = z.object({ type: z.literal("mindforge:ready") });

// ============================================================================
// Recording an attempt — `POST /v1/lessons/:lessonId/exercises/:key/attempts`
// ============================================================================

/**
 * One run of the tests, as the SPA reports it.
 *
 * The client reports its own results: the tests ran in the learner's browser,
 * and there is nowhere else they could have. This is a single-user product, so
 * a forged pass is the learner lying to themselves, and the row says where the
 * result came from rather than pretending the server checked it.
 *
 * `passed` is not sent. The server derives it — every result passed, and at
 * least one existed — so the rule for "passed" has one home.
 */
export const RecordAttemptSchema = z.object({
  code: Code,
  status: z.enum(RUN_STATUSES),
  results: z.array(TestResultSchema).max(200),
  /** When the learner first changed the starter code, if they did. Bounds "how long it took". */
  startedAt: z.iso.datetime().nullable().default(null),
});
export type RecordAttemptInput = z.infer<typeof RecordAttemptSchema>;

/** The single rule for whether an attempt passed. */
export function attemptPassed(status: RunStatus, results: readonly TestResult[]): boolean {
  return status === "completed" && results.length > 0 && results.every((r) => r.passed);
}

// ============================================================================
// Whiteboard reviews — `POST /v1/lessons/:lessonId/exercises/:key/reviews`
// ============================================================================

/** The canvas elements, capped by count. Each is kept as the editor produced it. */
export const SCENE_ELEMENTS_MAX = 2_000;
/** A base64 PNG of the canvas, under the model's image limit with room to spare. */
export const SCENE_IMAGE_MAX = 4_000_000;

/**
 * One element of a drawn scene, as far as the review needs to read it.
 *
 * Deliberately loose (`passthrough`): the canvas library owns the full shape and
 * revises it, and a review that rejected a drawing over a field it never reads
 * would be a learner who cannot submit their design. What is named here is what
 * `describeScene` uses.
 */
export const SceneElementSchema = z
  .object({
    id: z.string().max(100),
    type: z.string().max(40),
    text: z.string().max(2_000).optional(),
    containerId: z.string().max(100).nullable().optional(),
    isDeleted: z.boolean().optional(),
    startBinding: z
      .object({ elementId: z.string().max(100) })
      .nullable()
      .optional(),
    endBinding: z
      .object({ elementId: z.string().max(100) })
      .nullable()
      .optional(),
    boundElements: z
      .array(z.object({ id: z.string().max(100), type: z.string().max(40) }))
      .nullable()
      .optional(),
  })
  .passthrough();
export type SceneElement = z.infer<typeof SceneElementSchema>;

/**
 * The most a drawing may weigh, as JSON text. Under the database's own ceiling
 * (`exercise_attempts_scene_shape`, 2 MB) with room to spare, and checked **before**
 * the review is requested: a drawing that fails the database's check after the model
 * has read it is a review paid for and then rolled back, bill and all.
 */
export const SCENE_JSON_MAX = 1_000_000;

export const RequestReviewSchema = z.object({
  elements: z
    .array(SceneElementSchema)
    .max(SCENE_ELEMENTS_MAX)
    .refine((elements) => JSON.stringify(elements).length <= SCENE_JSON_MAX, {
      message: "the drawing is too large to review",
    }),
  /** `data:image/png;base64,…` or the bare base64. What the reviewer looks at. */
  image: z.string().min(1).max(SCENE_IMAGE_MAX),
  startedAt: z.iso.datetime().nullable().default(null),
});
export type RequestReviewInput = z.infer<typeof RequestReviewSchema>;

// ============================================================================
// Self-reported results — `POST /v1/lessons/:lessonId/exercises/:key/reports`
// ============================================================================

/** How much terminal output a report may carry. Enough for a failing test run, not a log file. */
export const TASK_OUTPUT_MAX = 20_000;

/**
 * "I ran it, and it passed" — or did not (the `task` kind).
 *
 * The learner's word, recorded as theirs. `output` is what their terminal printed,
 * when they paste it: optional, because the report is the fact and the output is
 * evidence for their own later reading.
 */
export const ReportTaskSchema = z.object({
  passed: z.boolean(),
  output: z.string().trim().max(TASK_OUTPUT_MAX).nullable().default(null),
});
export type ReportTaskInput = z.infer<typeof ReportTaskSchema>;
