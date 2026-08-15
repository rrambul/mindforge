import { describe, expect, it } from "vitest";

import {
  ActivityGridViewSchema,
  AgentRunViewSchema,
  CurriculumViewSchema,
  FocusSessionListSchema,
  FocusSessionViewSchema,
  IsoDateTimeSchema,
  LearningRecordSchema,
  LessonViewSchema,
  MeViewSchema,
  MemoryViewSchema,
  MissionListSchema,
  MissionViewSchema,
  ReferenceDocSchema,
  RunningFocusSessionSchema,
  SpendViewSchema,
} from "./wire.js";

/**
 * The response contract, exercised.
 *
 * Two things this proves that a type cannot. First, that each schema accepts what
 * the API actually sends — the samples below are the shape of a real `toXView`
 * return, so a schema that drifted from its handler fails here rather than in a
 * browser. Second, that a *missing* field is rejected: unknown keys are stripped
 * on purpose, so the only direction this contract catches is the one that breaks a
 * screen, and it has to actually catch it.
 */

const UUID = "3f1a2b4c-1111-4111-8111-222233334444";
const WHEN = "2026-08-08T12:00:00.000Z";

const MISSION = {
  id: UUID,
  topic: "Postgres RLS",
  why: null,
  successLooksLike: null,
  constraints: null,
  currentLevel: null,
  status: "active",
  createdAt: WHEN,
  updatedAt: WHEN,
};

const LESSON = {
  id: UUID,
  slug: "0001-row-level-security",
  title: "Row level security",
  intent: "Why a policy is not a WHERE clause",
  status: "generated",
  difficulty: 3,
  depth: "working",
  completed: true,
  outcome: "shaky",
  unblocked: true,
  blockedBy: [],
  dependentCount: 2,
};

const MODULE = {
  id: UUID,
  slug: "basics",
  name: "Basics",
  outcome: null,
  status: "active",
  prerequisites: [],
  progress: { completed: 1, total: 4 },
  outcomes: { understood: 0, shaky: 1, lost: 0, unrecorded: 0 },
  lessons: [LESSON],
};

const SESSION = {
  id: UUID,
  intention: null,
  startedAt: WHEN,
  endedAt: null,
  plannedMinutes: 25,
  minutes: null,
  isRunning: true,
  entryMode: "timer",
  hitIntention: null,
  focusQuality: null,
  energy: null,
  note: null,
  missionId: null,
  lessonId: null,
};

describe("every schema accepts what its handler sends", () => {
  it.each([
    ["MissionView", MissionViewSchema, MISSION],
    ["MissionList", MissionListSchema, { missions: [MISSION] }],
    [
      "CurriculumView",
      CurriculumViewSchema,
      {
        missionId: UUID,
        modules: [MODULE],
        progress: { completed: 1, total: 4, modulesNotPlanned: 2 },
        nextLessonId: null,
      },
    ],
    ["FocusSessionView", FocusSessionViewSchema, SESSION],
    ["RunningFocusSession", RunningFocusSessionSchema, { session: null }],
    ["FocusSessionList", FocusSessionListSchema, { sessions: [SESSION], nextCursor: null }],
    [
      "ActivityGridView",
      ActivityGridViewSchema,
      {
        from: "2026-08-01",
        to: "2026-08-08",
        cells: [{ day: "2026-08-01", value: 45, intensity: 3 }],
        activeDaysIn28: 12,
        signal: { kind: "never_on_weekday", weekday: 6 },
        rebuiltAt: WHEN,
      },
    ],
    [
      "LessonView",
      LessonViewSchema,
      {
        id: UUID,
        missionId: UUID,
        trackId: null,
        moduleName: "Basics",
        slug: "0001-rls",
        title: "RLS",
        intent: null,
        status: "generated",
        difficulty: null,
        depth: null,
        seq: 1,
        completedAt: null,
        outcome: null,
        view: { url: "https://lessons.example/x", expiresAt: WHEN },
      },
    ],
    [
      "ReferenceDoc",
      ReferenceDocSchema,
      { id: UUID, slug: "cheatsheet", title: "Cheatsheet", updatedAt: WHEN, url: null },
    ],
    [
      "LearningRecord",
      LearningRecordSchema,
      {
        id: UUID,
        seq: 1,
        title: "RLS",
        lessonId: null,
        lessonTitle: null,
        whatLearned: "Policies compose with AND",
        evidence: null,
        keyInsight: null,
        struggles: null,
        next: null,
        recordedAt: WHEN,
      },
    ],
    [
      "AgentRunView",
      AgentRunViewSchema,
      {
        id: UUID,
        missionId: UUID,
        kind: "generate_lesson",
        status: "succeeded_with_conflicts",
        error: null,
        result: {
          changes: { added: ["lessons/0001-rls.html"] },
          warnings: [{ code: "title_missing", args: { source: "filename" } }],
          conflicts: [{ path: "lessons/0001-rls.html", reason: "changed under us" }],
          sdkCostUsd: 2.5,
          turns: 26,
          durationMs: 480_000,
        },
        createdAt: WHEN,
        startedAt: WHEN,
        finishedAt: WHEN,
      },
    ],
    [
      "MemoryView",
      MemoryViewSchema,
      {
        id: UUID,
        slug: "background",
        kind: "background",
        summary: "Writes Go daily",
        writtenBy: "agent",
        confirmedAt: null,
        supersededBySlug: null,
        updatedAt: WHEN,
      },
    ],
    [
      "SpendView",
      SpendViewSchema,
      {
        day: "2026-08-08",
        spentUsd: 2.5,
        capUsd: 15,
        remainingUsd: 12.5,
        fraction: 0.1666,
        exhausted: false,
        unpricedCalls: 0,
        atLeast: false,
      },
    ],
    [
      "MeView",
      MeViewSchema,
      {
        userId: UUID,
        locale: "pt-BR",
        contentLanguage: "en",
        timezone: "America/Sao_Paulo",
        weekStartsOn: 0,
        theme: "dark",
        changelogSeenVersion: null,
      },
    ],
  ])("%s", (_name, schema, sample) => {
    expect(schema.safeParse(sample).success).toBe(true);
  });
});

describe("a field that disappears is caught", () => {
  it("rejects a mission with no status", () => {
    // The direction that actually breaks a screen. A server that *adds* a field
    // must not break an older client, which is why unknown keys are stripped
    // instead.
    const withoutStatus: Record<string, unknown> = { ...MISSION };
    delete withoutStatus["status"];

    expect(MissionViewSchema.safeParse(withoutStatus).success).toBe(false);
  });

  it("rejects a lesson whose `blockedBy` became a string", () => {
    const result = CurriculumViewSchema.safeParse({
      missionId: UUID,
      modules: [{ ...MODULE, lessons: [{ ...LESSON, blockedBy: "Prerequisites" }] }],
      progress: null,
      nextLessonId: null,
    });

    expect(result.success).toBe(false);
    // Named, so the error says which field rather than which endpoint.
    expect(result.error?.issues[0]?.path).toContain("blockedBy");
  });

  it("names the field when a run's status is one nobody has heard of", () => {
    const result = AgentRunViewSchema.safeParse({
      id: UUID,
      missionId: null,
      kind: "generate_lesson",
      status: "half_done",
      error: null,
      result: null,
      createdAt: WHEN,
      startedAt: null,
      finishedAt: null,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["status"]);
  });
});

describe("keys the server adds later", () => {
  it("are stripped rather than rejected, so an older client keeps working", () => {
    const parsed = MissionViewSchema.parse({ ...MISSION, archivedAt: WHEN });

    expect(parsed).not.toHaveProperty("archivedAt");
    expect(parsed.topic).toBe("Postgres RLS");
  });
});

describe("nulls that mean something", () => {
  it("accepts a module with no plan, which is not a module at zero", () => {
    // `moduleProgress` returns null rather than 0/0, and the wire has to be able
    // to carry that distinction (non-negotiable 10).
    expect(
      CurriculumViewSchema.safeParse({
        missionId: UUID,
        modules: [{ ...MODULE, progress: null, outcomes: null, lessons: [] }],
        progress: null,
        nextLessonId: null,
      }).success,
    ).toBe(true);
  });

  it("refuses a module progress with a zero denominator", () => {
    // 0/0 is what null exists to avoid. A total of zero on the wire would mean
    // somebody built the null case out of counts instead.
    expect(
      CurriculumViewSchema.safeParse({
        missionId: UUID,
        modules: [{ ...MODULE, progress: { completed: 0, total: 0 } }],
        progress: null,
        nextLessonId: null,
      }).success,
    ).toBe(false);
  });

  it("accepts an uncapped budget, which is not a budget of zero", () => {
    expect(
      SpendViewSchema.parse({
        day: "2026-08-08",
        spentUsd: 40,
        capUsd: null,
        remainingUsd: null,
        fraction: null,
        exhausted: false,
        unpricedCalls: 3,
        atLeast: true,
      }).capUsd,
    ).toBeNull();
  });
});

describe("IsoDateTimeSchema", () => {
  it("takes what `toISOString` produces and refuses what it does not", () => {
    expect(IsoDateTimeSchema.safeParse(WHEN).success).toBe(true);
    expect(IsoDateTimeSchema.safeParse("2026-08-08").success).toBe(false);
    expect(IsoDateTimeSchema.safeParse("yesterday").success).toBe(false);
  });
});
