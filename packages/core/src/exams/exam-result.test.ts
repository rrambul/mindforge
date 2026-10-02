import { describe, expect, it } from "vitest";

import {
  currentModule,
  examResult,
  moduleAwaitingExam,
  moduleFinishedAt,
  type ExamItemFacts,
  type ModuleStanding,
} from "./exam-result.js";

const at = (iso: string) => new Date(iso);

function item(overrides: Partial<ExamItemFacts> = {}): ExamItemFacts {
  return { key: "a", covers: [], grading: "checked", attempts: [], ...overrides };
}

describe("examResult", () => {
  it("is null for an exam with no items — nothing to pass is not a pass", () => {
    expect(examResult([])).toBeNull();
  });

  it("is not attempted and not passed before anything is tried", () => {
    const result = examResult([item({ key: "a" }), item({ key: "b" })])!;

    expect(result).toMatchObject({
      total: 2,
      passedCount: 0,
      attempted: false,
      passed: false,
      passedAt: null,
    });
    expect(result.items).toEqual([
      { key: "a", state: "not-tried" },
      { key: "b", state: "not-tried" },
    ]);
  });

  it("passes only when every item passes, at the latest first pass", () => {
    const result = examResult([
      item({
        key: "a",
        attempts: [{ createdAt: at("2026-10-01T10:00:00Z"), passed: true }],
      }),
      item({
        key: "b",
        attempts: [
          { createdAt: at("2026-10-02T10:00:00Z"), passed: true },
          { createdAt: at("2026-10-01T11:00:00Z"), passed: false },
          { createdAt: at("2026-10-03T10:00:00Z"), passed: false },
        ],
      }),
    ])!;

    expect(result.passed).toBe(true);
    expect(result.passedAt).toEqual(at("2026-10-02T10:00:00Z"));
    expect(result.items[1]).toEqual({
      key: "b",
      state: "passed",
      attemptsToPass: 2,
      passedAt: at("2026-10-02T10:00:00Z"),
      grading: "checked",
    });
    expect(result.revisit).toEqual([]);
  });

  it("reports 4 of 6 as 4 of 6, with the lessons the unpassed items cover", () => {
    const pass = [{ createdAt: at("2026-10-01T10:00:00Z"), passed: true }];
    const fail = [{ createdAt: at("2026-10-01T10:00:00Z"), passed: false }];

    const result = examResult([
      item({ key: "a", attempts: pass }),
      item({ key: "b", attempts: pass }),
      item({ key: "c", attempts: pass }),
      item({ key: "d", attempts: pass }),
      item({ key: "e", attempts: fail, covers: ["borrowing", "lifetimes"] }),
      item({ key: "f", covers: ["lifetimes", "traits"] }),
    ])!;

    expect(result).toMatchObject({ total: 6, passedCount: 4, passed: false, attempted: true });
    expect(result.items[4]).toEqual({ key: "e", state: "failed", attempts: 1 });
    expect(result.revisit).toEqual(["borrowing", "lifetimes", "traits"]);
  });

  it("counts a self-reported pass apart from a checked one", () => {
    const pass = [{ createdAt: at("2026-10-01T10:00:00Z"), passed: true }];
    const result = examResult([
      item({ key: "a", attempts: pass }),
      item({ key: "b", attempts: pass, grading: "self" }),
    ])!;

    expect(result).toMatchObject({ passedCount: 2, checkedPasses: 1, selfReportedPasses: 1 });
  });
});

describe("moduleFinishedAt", () => {
  it("is null for a module with no lessons", () => {
    expect(moduleFinishedAt([], at("2026-10-01T10:00:00Z"))).toBeNull();
  });

  it("is null until the exam is passed", () => {
    expect(moduleFinishedAt([at("2026-10-01T10:00:00Z")], null)).toBeNull();
  });

  it("is null while a lesson is unfinished, even with the exam passed", () => {
    expect(moduleFinishedAt([null, at("2026-10-01T10:00:00Z")], at("2026-10-02T10:00:00Z"))).toBe(
      null,
    );
  });

  it("is the later of the last lesson and the exam", () => {
    expect(moduleFinishedAt([at("2026-10-01T10:00:00Z")], at("2026-10-02T10:00:00Z"))).toEqual(
      at("2026-10-02T10:00:00Z"),
    );
    // A lesson the plan added after the exam was passed is what finishes the module.
    expect(moduleFinishedAt([at("2026-10-05T10:00:00Z")], at("2026-10-02T10:00:00Z"))).toEqual(
      at("2026-10-05T10:00:00Z"),
    );
  });
});

function standing(overrides: Partial<ModuleStanding> & { id: string }): ModuleStanding {
  return { lessonsDone: false, hasExam: false, finished: false, ...overrides };
}

describe("moduleAwaitingExam", () => {
  it("is the first module with every lesson done and no exam", () => {
    expect(
      moduleAwaitingExam([
        standing({ id: "m1", lessonsDone: true, hasExam: true, finished: true }),
        standing({ id: "m2", lessonsDone: true }),
        standing({ id: "m3", lessonsDone: true }),
      ]),
    ).toBe("m2");
  });

  it("is null when every finished module has an exam, or none is finished", () => {
    expect(moduleAwaitingExam([standing({ id: "m1" })])).toBeNull();
    expect(
      moduleAwaitingExam([standing({ id: "m1", lessonsDone: true, hasExam: true })]),
    ).toBeNull();
  });
});

describe("currentModule", () => {
  it("is a module waiting on its exam before the module of the next lesson", () => {
    expect(
      currentModule(
        [standing({ id: "m1", lessonsDone: true, hasExam: true }), standing({ id: "m2" })],
        "m2",
      ),
    ).toBe("m1");
  });

  it("is the next lesson's module once every earlier module is finished", () => {
    expect(
      currentModule(
        [
          standing({ id: "m1", lessonsDone: true, hasExam: true, finished: true }),
          standing({ id: "m2" }),
        ],
        "m2",
      ),
    ).toBe("m2");
  });

  it("is null with nothing left", () => {
    expect(currentModule([], null)).toBeNull();
  });
});
