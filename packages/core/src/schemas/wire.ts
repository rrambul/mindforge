import { z } from "zod";

import { STRAIN_REASONS, STRAIN_VERDICTS } from "../exercises/strain.js";
import { SUPPORTED_LOCALES } from "../i18n/locales.js";
import { IsoDateSchema } from "./common.js";
import {
  CodeExerciseSchema,
  SceneElementSchema,
  TaskExerciseSchema,
  TestResultSchema,
  WhiteboardExerciseSchema,
} from "./exercise.js";
import { EntryModeSchema, IntentionOutcomeSchema } from "./focus.js";
import { HINT_RUNGS, HintLevelSchema } from "./hint.js";
import { LessonOutcomeSchema } from "./lesson.js";
import { MissionStatusSchema } from "./mission.js";
import { ThemeSchema } from "./profile.js";

/**
 * **The response contract**, in one file, shared by the API and the SPA.
 *
 * Until this existed the two ends described every response *twice*: the API had
 * `LessonView` in `get-curriculum.ts` and the SPA had `CurriculumLesson` in
 * `use-curriculum.ts`, with the comment "Mirrors `LessonView` in the API's
 * `get-curriculum.ts`" as the entire link between them. There were around fifty
 * such declarations, and `http.ts` ended in `return payload as T` — an unchecked
 * cast, so nothing at all connected the two.
 *
 * What that cost: rename `blockedBy` to `blockingLessons` on the server and lint,
 * typecheck, the boundary rules, the i18n gate and every unit suite stay green.
 * The lock on the curriculum screen quietly loses its reason at runtime, and only
 * an E2E spec that happened to assert on that text would notice.
 *
 * Three decisions, each with a plausible-looking alternative:
 *
 * 1. **One file, not one per module.** The value of this contract is that drift is
 *    *visible*, and nine files reproduce the problem it was written to solve at a
 *    coarser grain. The request schemas stay beside their features because they
 *    are validated in one place; a response is validated at both ends.
 *
 * 2. **Schemas, not shared interfaces.** A shared `interface` would bind the two
 *    ends at compile time and still let a server return something else — a stale
 *    deploy, a hand-written `$queryRaw` row, a null nobody expected. The SPA parses,
 *    so a contract violation surfaces as one error naming the field rather than as
 *    `undefined` three components away.
 *
 * 3. **Unknown keys are stripped, not rejected.** zod's default, and the right one:
 *    a server that adds a field must not break clients that predate it. The
 *    reverse — a field that *disappears* — is what this catches, and that is the
 *    direction that actually breaks a screen.
 *
 * `z.infer` from these types the API's own view interfaces, so a handler that
 * stopped returning a field no longer compiles.
 */

/**
 * An instant on the wire: ISO 8601, UTC, as every `toXView` produces.
 *
 * Kept as a string rather than coerced to a `Date`. Every consumer either renders
 * it in the learner's timezone or hands it back unchanged, and a schema that
 * silently produced `Date` objects would make the parsed type differ from the JSON
 * the API actually sent — which is the sort of gap this file exists to close.
 */
export const IsoDateTimeSchema = z.iso.datetime();

/**
 * An identifier the server minted, on the way out.
 *
 * A non-empty string rather than `IdSchema`, and the asymmetry with the request
 * schemas is deliberate. On the way *in*, a uuid check is load-bearing: an
 * unvalidated id reaches a Postgres `uuid` column as a failed cast, which surfaces
 * as a 500 from the driver rather than the 422 it is. On the way *out* there is
 * nothing to protect — the SPA hands the value back untouched, and re-validating
 * the server's own id generation only buys a contract strict enough to reject a
 * response that was perfectly usable.
 */
export const IdSchema = z.string().min(1);

// ============================================================================
// Missions — `mission.view.ts`
// ============================================================================

export const MissionViewSchema = z.object({
  id: IdSchema,
  topic: z.string(),
  why: z.string().nullable(),
  successLooksLike: z.string().nullable(),
  constraints: z.string().nullable(),
  currentLevel: z.string().nullable(),
  status: MissionStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  // `userId` is deliberately absent, as the view says: the caller is the owner by
  // construction, so returning it would be noise a client could start keying off.
});
export type MissionView = z.infer<typeof MissionViewSchema>;

export const MissionListSchema = z.object({ missions: z.array(MissionViewSchema).readonly() });
export type MissionList = z.infer<typeof MissionListSchema>;

// ============================================================================
// Curriculum — `get-curriculum.ts`
// ============================================================================

/**
 * `moduleProgress`'s own shape, which returns null rather than 0/0.
 *
 * Two counts and no ratio, deliberately: the fraction is arithmetic over these
 * two, and putting it on the wire as well would be the same number twice with
 * nothing keeping the copies equal. `total` is positive because a module with no
 * lessons produces null, not a zero denominator.
 */
export const ModuleProgressSchema = z.object({
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});

export const MissionProgressSchema = ModuleProgressSchema.extend({
  /**
   * How many modules the fraction could not see. Present so the screen can say the
   * bar does not cover everything, rather than counting an unplanned module as a
   * zero — which would make the bar *fall* as the curriculum grows.
   */
  modulesNotPlanned: z.number().int().nonnegative(),
});

export const OutcomeCountsSchema = z.object({
  understood: z.number().int().nonnegative(),
  shaky: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  /** Completed before an outcome could be recorded. The four sum to `completed`. */
  unrecorded: z.number().int().nonnegative(),
});

export const LessonDepthSchema = z.enum(["overview", "working", "deep_dive"]);
export const LessonStatusSchema = z.enum(["planned", "generated"]);

/**
 * How a lesson landed, from what the learner did (FR-D1, `lessonStrain`).
 *
 * A verdict always carries its reasons, and an unknown always says which kind —
 * "in progress" and "nothing to judge" are different facts, and neither is "in the
 * zone" (non-negotiable 10).
 */
export const StrainViewSchema = z.union([
  z.object({
    verdict: z.enum(STRAIN_VERDICTS),
    reasons: z.array(z.enum(STRAIN_REASONS)).min(1).readonly(),
  }),
  z.object({
    verdict: z.null(),
    unknown: z.enum(["in-progress", "no-exercise", "not-attempted"]),
  }),
]);
export type StrainView = z.infer<typeof StrainViewSchema>;

/**
 * What a lesson changed about the plan, as the lesson itself declared it (FR-D4).
 * `bridgeFor` is resolved to the lesson it names, so the screen can link it; null
 * when a bridge named a slug this mission does not have.
 */
export const LessonAdjustmentViewSchema = z.object({
  kind: z.enum(["bridge", "harder"]),
  reason: z.string().nullable(),
  bridgeFor: z.object({ id: IdSchema, title: z.string() }).nullable(),
});
export type LessonAdjustmentView = z.infer<typeof LessonAdjustmentViewSchema>;

/** What the next lesson will do about how the last ones landed (`nextAdjustment`). */
export const UpcomingAdjustmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bridge"), lessonId: IdSchema, title: z.string() }),
  z.object({
    kind: z.literal("harder"),
    lessons: z
      .array(z.object({ id: IdSchema, title: z.string() }))
      .length(2)
      .readonly(),
  }),
  z.object({ kind: z.literal("as-planned") }),
]);
export type UpcomingAdjustment = z.infer<typeof UpcomingAdjustmentSchema>;

export const CurriculumLessonSchema = z.object({
  id: IdSchema,
  slug: z.string(),
  title: z.string(),
  intent: z.string().nullable(),
  status: LessonStatusSchema,
  /** 1–5 for this learner, or null when the plan did not say. Never defaulted. */
  difficulty: z.number().int().min(1).max(5).nullable(),
  depth: LessonDepthSchema.nullable(),
  completed: z.boolean(),
  outcome: LessonOutcomeSchema.nullable(),
  unblocked: z.boolean(),
  /** Titles of the prerequisites still unfinished, so the lock reads as a sentence. */
  blockedBy: z.array(z.string()).readonly(),
  dependentCount: z.number().int().nonnegative(),
  /** How it landed. Planned lessons are `in-progress`: nothing to judge yet. */
  strain: StrainViewSchema,
  adjustment: LessonAdjustmentViewSchema.nullable(),
  /** The bridge lesson already written toward this one, if any — one per lesson (FR-D2). */
  bridge: z.object({ id: IdSchema, title: z.string() }).nullable(),
});
export type CurriculumLesson = z.infer<typeof CurriculumLessonSchema>;

export const CurriculumModuleSchema = z.object({
  id: IdSchema,
  slug: z.string(),
  name: z.string(),
  outcome: z.string().nullable(),
  status: z.string(),
  prerequisites: z.array(z.string()).readonly(),
  /** Null when the module has no lessons at all: not planned yet, never 0%. */
  progress: ModuleProgressSchema.nullable(),
  outcomes: OutcomeCountsSchema.nullable(),
  lessons: z.array(CurriculumLessonSchema).readonly(),
});
export type CurriculumModule = z.infer<typeof CurriculumModuleSchema>;

export const CurriculumViewSchema = z.object({
  missionId: IdSchema,
  modules: z.array(CurriculumModuleSchema).readonly(),
  progress: MissionProgressSchema.nullable(),
  nextLessonId: IdSchema.nullable(),
  /** Null when no finished lesson has been judged yet — no signal, which is not "as planned". */
  upcoming: UpcomingAdjustmentSchema.nullable(),
});
export type CurriculumView = z.infer<typeof CurriculumViewSchema>;

// ============================================================================
// Focus — `focus.controller.ts`
// ============================================================================

export const FocusSessionViewSchema = z.object({
  id: IdSchema,
  intention: z.string().nullable(),
  startedAt: IsoDateTimeSchema,
  endedAt: IsoDateTimeSchema.nullable(),
  plannedMinutes: z.number().int().nullable(),
  /**
   * Null while running, and not because it is unknown: a running session's
   * elapsed time is a function of *now*, so the client ticks it locally and a
   * server-rendered figure would be stale on arrival.
   */
  minutes: z.number().int().nullable(),
  isRunning: z.boolean(),
  entryMode: EntryModeSchema,
  hitIntention: IntentionOutcomeSchema.nullable(),
  focusQuality: z.number().int().nullable(),
  energy: z.number().int().nullable(),
  note: z.string().nullable(),
  missionId: IdSchema.nullable(),
  lessonId: IdSchema.nullable(),
});
export type FocusSessionView = z.infer<typeof FocusSessionViewSchema>;

/**
 * An envelope rather than a bare `null`, as the controller says: the response is a
 * JSON object either way, which every client handles better than a naked null body.
 */
export const RunningFocusSessionSchema = z.object({
  session: FocusSessionViewSchema.nullable(),
});

export const FocusSessionListSchema = z.object({
  sessions: z.array(FocusSessionViewSchema).readonly(),
  /**
   * Opaque, and the client's only correct move is to hand it back. Null means this
   * is the last page — distinct from an empty string, which would be a cursor.
   */
  nextCursor: z.string().nullable(),
});
export type FocusSessionList = z.infer<typeof FocusSessionListSchema>;

// ============================================================================
// Insights — `insights.controller.ts`
// ============================================================================

export const GridCellSchema = z.object({
  day: IsoDateSchema,
  /** Focus minutes. */
  value: z.number().nonnegative(),
  /** 0–4. Zero means nothing happened; 1–4 are quartiles of your own non-empty days. */
  intensity: z.number().int().min(0).max(4),
});

/**
 * A pattern worth naming, or null for "nothing stood out".
 *
 * A discriminated union of one today. Written as a union anyway so a second
 * signal is an added member rather than a reshaped field, and `kind` is already
 * there to switch on.
 */
export const GridSignalSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("never_on_weekday"), weekday: z.number().int().min(0).max(6) }),
  ])
  .nullable();

export const ActivityGridViewSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  /** One cell per day in the range, in order, including the empty ones. */
  cells: z.array(GridCellSchema).readonly(),
  /** The figure that replaces a streak: it degrades and cannot be broken by one bad week. */
  activeDaysIn28: z.number().int().nonnegative(),
  signal: GridSignalSchema,
  /**
   * Null on a range with no rows. "You did nothing in March" and "March was never
   * rolled up" are different answers, and the UI cannot tell a quiet month from a
   * broken job without this.
   */
  rebuiltAt: IsoDateTimeSchema.nullable(),
});
export type ActivityGridView = z.infer<typeof ActivityGridViewSchema>;

// ============================================================================
// Lessons and the library — `lesson.view.ts`, `library.controller.ts`
// ============================================================================

/**
 * Null means there is nothing to open, which is a real and common state — a
 * planned lesson has no file. The reader distinguishes it from a failure, because
 * "not written yet" is an invitation and an error is not.
 */
export const LessonGrantSchema = z.object({
  url: z.url(),
  expiresAt: IsoDateTimeSchema,
});

export const LessonViewSchema = z.object({
  id: IdSchema,
  missionId: IdSchema,
  trackId: IdSchema.nullable(),
  moduleName: z.string().nullable(),
  slug: z.string(),
  title: z.string(),
  intent: z.string().nullable(),
  status: LessonStatusSchema,
  difficulty: z.number().int().min(1).max(5).nullable(),
  depth: LessonDepthSchema.nullable(),
  seq: z.number().int().nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  outcome: LessonOutcomeSchema.nullable(),
  view: LessonGrantSchema.nullable(),
});
export type LessonView = z.infer<typeof LessonViewSchema>;

// ============================================================================
// Exercises — `exercises.controller.ts` (FR-X1–X6)
// ============================================================================

/**
 * What the learner has done with one exercise so far.
 *
 * `firstPassedAt` null with `count > 0` is "tried, not yet passed", which is a
 * different fact from `count === 0`, "not tried" — and neither is a zero score.
 */
export const ExerciseAttemptsSummarySchema = z.object({
  count: z.number().int().min(0),
  firstPassedAt: IsoDateTimeSchema.nullable(),
  /** The code from the most recent attempt, so a reload resumes where you left off. */
  lastCode: z.string().nullable(),
  lastPassed: z.boolean().nullable(),
  lastAt: IsoDateTimeSchema.nullable(),
  /** What the last attempt said, test by test or rubric item by item — so a reload keeps the feedback. */
  lastResults: z.array(TestResultSchema).readonly().nullable(),
  /** A whiteboard's last submitted drawing, so the canvas resumes. Null for code. */
  lastScene: z.array(SceneElementSchema).readonly().nullable(),
});
export type ExerciseAttemptsSummary = z.infer<typeof ExerciseAttemptsSummarySchema>;

/** One hint as it was given (FR-H3). `rung` travels with `level` so no client has to map one to the other. */
/**
 * `hint` is a rung the learner asked for; `solution` is the reference solution they
 * chose to open. Both are help, and a solution counts as the top rung: a pass after
 * seeing the answer is not a pass worked out alone (non-negotiable 10).
 */
export const HINT_KINDS = ["hint", "solution"] as const;

export const HintViewSchema = z.object({
  kind: z.enum(HINT_KINDS),
  level: HintLevelSchema,
  rung: z.enum(HINT_RUNGS),
  question: z.string().nullable(),
  answer: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type HintView = z.infer<typeof HintViewSchema>;

const ExerciseProgress = {
  attempts: ExerciseAttemptsSummarySchema,
  /** Every hint given, oldest first. Empty is "no help asked for", which is a fact worth showing. */
  hints: z.array(HintViewSchema).readonly(),
  /** The highest rung the learner may ask for next — the server's, so the ladder has one rule. */
  nextHintLevel: HintLevelSchema,
};

/**
 * A whiteboard exercise on the wire. `rubric` and `solution` are **null until the
 * first review**, withheld by the server rather than hidden by the screen: a
 * checklist of what a good answer covers, shown before the learner draws, is the
 * answer shown before they draw.
 */
export const WhiteboardExerciseViewSchema = WhiteboardExerciseSchema.extend({
  ...ExerciseProgress,
  rubric: z.array(z.string()).readonly().nullable(),
  solution: z.string().nullable(),
});

export const ExerciseViewSchema = z.discriminatedUnion("kind", [
  CodeExerciseSchema.extend(ExerciseProgress),
  WhiteboardExerciseViewSchema,
  TaskExerciseSchema.extend(ExerciseProgress),
]);
export type ExerciseView = z.infer<typeof ExerciseViewSchema>;

export const LessonExercisesViewSchema = z.object({
  lessonId: IdSchema,
  /**
   * The runner page on the lessons origin. From the server, like a lesson's view
   * URL, so the SPA is never configured with a second copy of the lessons origin
   * that could disagree with the one the API signs grants for.
   */
  runnerUrl: z.url(),
  /**
   * The Python runner: its own route, because only Python needs `connect-src 'self'`
   * to fetch its interpreter. JavaScript and TypeScript run under `connect-src 'none'`.
   */
  pythonRunnerUrl: z.url(),
  /** How this lesson landed so far (FR-D1). */
  strain: StrainViewSchema,
  exercises: z.array(ExerciseViewSchema).readonly(),
});
export type LessonExercisesView = z.infer<typeof LessonExercisesViewSchema>;

export const ReferenceDocSchema = z.object({
  id: IdSchema,
  slug: z.string(),
  title: z.string(),
  updatedAt: IsoDateTimeSchema,
  /** Null when there is nothing to open — the mission has no workspace yet. */
  url: z.url().nullable(),
});
export type ReferenceDoc = z.infer<typeof ReferenceDocSchema>;

export const LearningRecordSchema = z.object({
  id: IdSchema,
  seq: z.number().int(),
  title: z.string(),
  lessonId: IdSchema.nullable(),
  lessonTitle: z.string().nullable(),
  whatLearned: z.string(),
  evidence: z.string().nullable(),
  keyInsight: z.string().nullable(),
  struggles: z.string().nullable(),
  next: z.string().nullable(),
  recordedAt: IsoDateTimeSchema,
});
export type LearningRecord = z.infer<typeof LearningRecordSchema>;

// ============================================================================
// Teach — `teach.controller.ts`, `teach-spend.ts`
// ============================================================================

export const AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "succeeded_with_conflicts",
  "failed",
  "cancelled",
] as const;
export const AgentRunStatusSchema = z.enum(AGENT_RUN_STATUSES);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

/** Stable keys plus ICU args, never prose — the run screen renders in pt-BR too. */
export const RunWarningSchema = z.object({
  code: z.string(),
  args: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type RunWarning = z.infer<typeof RunWarningSchema>;

export const RunResultSchema = z.object({
  changes: z.record(z.string(), z.array(z.string()).readonly()).optional(),
  warnings: z.array(RunWarningSchema).readonly().optional(),
  conflicts: z
    .array(z.object({ path: z.string(), reason: z.string() }))
    .readonly()
    .optional(),
  memoriesWritten: z.number().int().nonnegative().optional(),
  /**
   * The SDK's own estimate, kept as a cross-check and never as the source of
   * truth: it prices from a table baked in when the SDK was built, and its own
   * docs say not to bill from it (§8.6).
   */
  sdkCostUsd: z.number().optional(),
  turns: z.number().int().optional(),
  durationMs: z.number().int().optional(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export const AgentRunViewSchema = z.object({
  id: IdSchema,
  missionId: IdSchema.nullable(),
  kind: z.string(),
  status: AgentRunStatusSchema,
  error: z.string().nullable(),
  result: RunResultSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.nullable(),
  finishedAt: IsoDateTimeSchema.nullable(),
  // `heartbeatAt` is deliberately absent, as the controller says: it is a lease
  // between the worker and the reaper, and putting it on the wire invites a client
  // to form a second, differently-wrong opinion about whether a run is alive.
});
export type AgentRunView = z.infer<typeof AgentRunViewSchema>;

export const MEMORY_KINDS = [
  "background",
  "teaching_preference",
  "learning_pattern",
  "constraint",
] as const;

export const MemoryViewSchema = z.object({
  id: IdSchema,
  slug: z.string(),
  /**
   * Not an enum on the wire. The agent writes this file and the parser stores what
   * it finds, so a kind nobody has a translation for must still reach the screen —
   * rejecting the response would hide the whole list over one unfamiliar word.
   */
  kind: z.string(),
  summary: z.string(),
  writtenBy: z.string(),
  confirmedAt: IsoDateTimeSchema.nullable(),
  supersededBySlug: z.string().nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type MemoryView = z.infer<typeof MemoryViewSchema>;

/** `budgetStatus` plus the day it measured. See `spend/budget.ts` for every null. */
export const SpendViewSchema = z.object({
  day: IsoDateSchema,
  spentUsd: z.number().nonnegative(),
  capUsd: z.number().nonnegative().nullable(),
  remainingUsd: z.number().nonnegative().nullable(),
  fraction: z.number().min(0).max(1).nullable(),
  exhausted: z.boolean(),
  unpricedCalls: z.number().int().nonnegative(),
  atLeast: z.boolean(),
});
export type SpendView = z.infer<typeof SpendViewSchema>;

// ============================================================================
// Account — `me.controller.ts`
// ============================================================================

export const MeViewSchema = z.object({
  userId: IdSchema,
  locale: z.enum(SUPPORTED_LOCALES),
  /** What the agent writes lessons in. A separate setting from `locale` (FR-L3). */
  contentLanguage: z.enum(SUPPORTED_LOCALES),
  timezone: z.string(),
  /** 0 = Sunday, matching `WeekStart`. */
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  theme: ThemeSchema,
  /** Null means never opened, which is not the same as up to date. */
  changelogSeenVersion: z.string().nullable(),
});
export type MeView = z.infer<typeof MeViewSchema>;
