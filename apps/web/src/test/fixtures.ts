import {
  ActivityGridViewSchema,
  AgentRunViewSchema,
  CurriculumViewSchema,
  FocusSessionViewSchema,
  LessonViewSchema,
  MeViewSchema,
  MissionViewSchema,
  type ActivityGridView,
  type AgentRunView,
  type CurriculumLesson,
  type CurriculumModule,
  type CurriculumView,
  type FocusSessionView,
  type LessonView,
  type MeView,
  type MissionView,
} from "@mindforge/core";

/**
 * Responses stated the way the API states them.
 *
 * `msw.ts` has said this about *failures* since M1 — "so a test cannot accidentally
 * assert against a shape the server never sends" — and nothing said it about
 * successes. The consequence was exactly what you would expect: `/me` fixtures with
 * four of the seven fields, a curriculum lesson with no `dependentCount`, a lesson
 * with no `slug`. Every one of them passed, because `api.get` cast the body and
 * asked no questions.
 *
 * **Each builder parses.** A fixture is run through the same schema the SPA parses
 * with, so an override that misspells a field or drops a required one fails in the
 * test that wrote it, naming the field — rather than surfacing as a component
 * rendering `undefined` several assertions later. That is the whole point: a test
 * double that cannot be wrong about the contract.
 */

const UUID = "11111111-1111-4111-8111-111111111111";
const WHEN = "2026-08-08T12:00:00.000Z";

export function meResponse(overrides: Partial<MeView> = {}): MeView {
  return MeViewSchema.parse({
    userId: UUID,
    locale: "en",
    contentLanguage: "en",
    timezone: "UTC",
    weekStartsOn: 1,
    theme: "light",
    changelogSeenVersion: null,
    ...overrides,
  });
}

export function missionResponse(overrides: Partial<MissionView> = {}): MissionView {
  return MissionViewSchema.parse({
    id: UUID,
    topic: "Postgres RLS",
    why: null,
    successLooksLike: null,
    constraints: null,
    currentLevel: null,
    status: "active",
    createdAt: WHEN,
    updatedAt: WHEN,
    ...overrides,
  });
}

export function focusSessionResponse(overrides: Partial<FocusSessionView> = {}): FocusSessionView {
  return FocusSessionViewSchema.parse({
    id: UUID,
    intention: null,
    startedAt: WHEN,
    endedAt: null,
    plannedMinutes: null,
    minutes: null,
    isRunning: true,
    entryMode: "timer",
    hitIntention: null,
    focusQuality: null,
    energy: null,
    note: null,
    missionId: null,
    lessonId: null,
    ...overrides,
  });
}

/** The envelope, which is a bare object rather than a `null` body for every client's sake. */
export function runningSessionResponse(session: FocusSessionView | null = null): {
  session: FocusSessionView | null;
} {
  return { session };
}

export function focusSessionListResponse(
  sessions: readonly FocusSessionView[] = [],
  nextCursor: string | null = null,
): { sessions: readonly FocusSessionView[]; nextCursor: string | null } {
  return { sessions, nextCursor };
}

export function lessonResponse(overrides: Partial<LessonView> = {}): LessonView {
  return LessonViewSchema.parse({
    id: UUID,
    missionId: UUID,
    trackId: null,
    moduleName: null,
    slug: "0001-lesson",
    title: "A lesson",
    intent: null,
    status: "generated",
    difficulty: null,
    depth: null,
    seq: 1,
    completedAt: null,
    outcome: null,
    view: { url: "http://localhost:3001/view/abc", expiresAt: WHEN },
    ...overrides,
  });
}

export function curriculumLesson(overrides: Partial<CurriculumLesson> = {}): CurriculumLesson {
  return {
    id: UUID,
    slug: "0001-lesson",
    title: "A lesson",
    intent: null,
    status: "generated",
    difficulty: null,
    depth: null,
    completed: false,
    outcome: null,
    unblocked: true,
    blockedBy: [],
    dependentCount: 0,
    ...overrides,
  };
}

export function curriculumModule(overrides: Partial<CurriculumModule> = {}): CurriculumModule {
  return {
    id: UUID,
    slug: "basics",
    name: "Basics",
    outcome: null,
    status: "active",
    prerequisites: [],
    progress: null,
    outcomes: null,
    lessons: [],
    ...overrides,
  };
}

/**
 * Parsed at the top level, so a malformed module or lesson inside is caught too —
 * the builders above are plain objects precisely so this one validation covers the
 * whole tree rather than each node paying for its own.
 */
export function curriculumResponse(overrides: Partial<CurriculumView> = {}): CurriculumView {
  return CurriculumViewSchema.parse({
    missionId: UUID,
    modules: [],
    progress: null,
    nextLessonId: null,
    ...overrides,
  });
}

export function agentRunResponse(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return AgentRunViewSchema.parse({
    id: UUID,
    missionId: UUID,
    kind: "generate_lesson",
    status: "succeeded",
    error: null,
    result: null,
    createdAt: WHEN,
    startedAt: WHEN,
    finishedAt: WHEN,
    ...overrides,
  });
}

export function activityGridResponse(overrides: Partial<ActivityGridView> = {}): ActivityGridView {
  return ActivityGridViewSchema.parse({
    from: "2026-08-01",
    to: "2026-08-08",
    cells: [],
    activeDaysIn28: 0,
    signal: null,
    rebuiltAt: null,
    ...overrides,
  });
}
