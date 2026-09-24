import { describe, expect, it } from "vitest";

import {
  attemptPassed,
  ExerciseDeclarationSchema,
  ExerciseKeySchema,
  RecordAttemptSchema,
  ReportTaskSchema,
  RequestReviewSchema,
  RunnerRequestSchema,
  RunnerResponseSchema,
  SCENE_JSON_MAX,
  TaskFilePathSchema,
} from "./exercise.js";

const DECLARATION = {
  key: "retry-backoff",
  kind: "code",
  language: "typescript",
  title: "Retry with backoff",
  prompt: "Write retry().",
  starter: "export function retry() {}\n",
  tests: 'import { retry } from "./solution";\ntest("x", () => expect(1).toBe(1));\n',
};

describe("ExerciseDeclarationSchema", () => {
  it("accepts a code exercise and defaults the optional fields to null, not to zero", () => {
    const parsed = ExerciseDeclarationSchema.parse(DECLARATION);

    expect(parsed.solution).toBeNull();
    // "The lesson did not say" is not "it takes no time".
    expect(parsed.expectedMinutes).toBeNull();
  });

  it("refuses an exercise with no tests, which would have no feedback loop", () => {
    expect(ExerciseDeclarationSchema.safeParse({ ...DECLARATION, tests: "" }).success).toBe(false);
  });

  it("refuses kinds that have no screen yet", () => {
    expect(
      ExerciseDeclarationSchema.safeParse({ ...DECLARATION, kind: "whiteboard" }).success,
    ).toBe(false);
  });
});

describe("ExerciseKeySchema", () => {
  it.each(["retry-backoff", "a", "step-2"])("accepts %s", (key) => {
    expect(ExerciseKeySchema.safeParse(key).success).toBe(true);
  });

  it.each(["", "Retry", "two words", "../up", "trailing-", "a/b"])("refuses %j", (key) => {
    // Keys go into a URL path segment; anything that is not dash-case is refused
    // rather than encoded, so there is one spelling of each key.
    expect(ExerciseKeySchema.safeParse(key).success).toBe(false);
  });
});

describe("the runner protocol", () => {
  it("parses a request and a response", () => {
    expect(
      RunnerRequestSchema.parse({
        type: "mindforge:run",
        runId: "r1",
        language: "javascript",
        code: "",
        tests: "",
      }).runId,
    ).toBe("r1");

    expect(
      RunnerResponseSchema.parse({
        type: "mindforge:result",
        runId: "r1",
        status: "completed",
        results: [{ name: "adds", passed: true, message: null }],
        message: null,
        logs: [],
      }).results,
    ).toHaveLength(1);
  });

  it("refuses a response that is not a result, whatever else it carries", () => {
    expect(RunnerResponseSchema.safeParse({ type: "mindforge:ready" }).success).toBe(false);
  });
});

describe("RecordAttemptSchema", () => {
  it("defaults startedAt to null when the learner never edited the starter", () => {
    expect(
      RecordAttemptSchema.parse({ code: "x", status: "error", results: [] }).startedAt,
    ).toBeNull();
  });
});

describe("attemptPassed", () => {
  const pass = { name: "a", passed: true, message: null };
  const fail = { name: "b", passed: false, message: "expected 1 to be 2" };

  it("passes only when every test passed", () => {
    expect(attemptPassed("completed", [pass, pass])).toBe(true);
    expect(attemptPassed("completed", [pass, fail])).toBe(false);
  });

  it("never passes a run with no results — an empty suite proves nothing", () => {
    expect(attemptPassed("completed", [])).toBe(false);
  });

  it("never passes an error or a timeout, whatever results it carries", () => {
    expect(attemptPassed("error", [pass])).toBe(false);
    expect(attemptPassed("timeout", [pass])).toBe(false);
  });
});

describe("RequestReviewSchema", () => {
  const request = (elements: unknown[]) => ({ elements, image: "AAAA" });

  it("accepts a drawing, and defaults its start to unknown", () => {
    expect(
      RequestReviewSchema.parse(request([{ id: "a", type: "rectangle" }])).startedAt,
    ).toBeNull();
  });

  it("refuses a drawing too large to store, before anything reads it", () => {
    // Under the database's own 2 MB check, so a drawing is never reviewed and then
    // rolled back — bill and all — for being too big to keep.
    const heavy = [{ id: "f", type: "freedraw", points: "x".repeat(SCENE_JSON_MAX) }];

    expect(RequestReviewSchema.safeParse(request(heavy)).success).toBe(false);
  });
});

describe("a task's files", () => {
  it.each(["mix.exs", "lib/counter.ex", "test/counter_test.exs", ".formatter.exs"])(
    "accepts a path inside the project: %s",
    (path) => {
      expect(TaskFilePathSchema.safeParse(path).success).toBe(true);
    },
  );

  it.each(["/etc/passwd", "../x", "a/../b", "a\\b", ".."])(
    "refuses a path that leaves the project: %s",
    (path) => {
      expect(TaskFilePathSchema.safeParse(path).success).toBe(false);
    },
  );

  it("takes a report with no output as a report, not as a missing one", () => {
    expect(ReportTaskSchema.parse({ passed: true })).toEqual({ passed: true, output: null });
  });
});
