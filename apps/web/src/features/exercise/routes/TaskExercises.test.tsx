import type { ExerciseAttemptsSummary, ReportTaskInput } from "@mindforge/core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_ATTEMPTS,
  lessonExercisesResponse,
  taskExerciseResponse,
} from "../../../test/fixtures.js";
import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { LessonExercises } from "./LessonExercises.js";

/**
 * An exercise run on the learner's own machine (the `task` kind).
 *
 * The app cannot see the run, so these tests hold on to the two things it can
 * promise: everything needed to set the exercise up is on screen and copyable, and
 * everything it records is labelled as the learner's report — never "passed" as if
 * a test the app ran had said so.
 */

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const LESSON = "88888888-8888-4888-8888-888888888888";

function serves(task = taskExerciseResponse()) {
  server.use(
    http.get(`${API}/lessons/${LESSON}/exercises`, () =>
      HttpResponse.json(lessonExercisesResponse({ lessonId: LESSON, exercises: [task] })),
    ),
  );
}

function reports(answer = taskExerciseResponse()) {
  const bodies: ReportTaskInput[] = [];
  server.use(
    http.post(`${API}/lessons/${LESSON}/exercises/:key/reports`, async ({ request }) => {
      bodies.push((await request.json()) as ReportTaskInput);
      return HttpResponse.json(answer, { status: 201 });
    }),
  );
  return bodies;
}

const render = () => renderWithProviders(<LessonExercises lessonId={LESSON} />);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a task exercise", () => {
  it("shows the task, every file, the command, and says it runs on your machine", async () => {
    serves();
    render();

    expect(
      await screen.findByRole("region", { name: "Exercise: A Lamport clock in Elixir" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "This one runs on your machine — Mindforge can't run Elixir in the browser.",
      ),
    ).toBeVisible();
    expect(screen.getByText("lib/clock.ex")).toBeVisible();
    expect(screen.getByText("test/clock_test.exs")).toBeVisible();
    expect(screen.getByText(/def receive\(local, _received\)/u)).toBeVisible();
    expect(screen.getByText("mix test")).toBeVisible();
    expect(screen.getByText("Run this from the project root")).toBeVisible();
  });

  it("loads no runner and offers no hints — nothing here runs in the browser", async () => {
    serves();
    render();
    await screen.findByRole("region", { name: "Exercise: A Lamport clock in Elixir" });

    expect(screen.queryByTitle("Test runner")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Get a hint/u })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run tests" })).toBeNull();
  });

  it("copies a file's contents, and says so", async () => {
    serves();
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render();

    await user.click(await screen.findByRole("button", { name: "Copy lib/clock.ex" }));

    expect(writeText).toHaveBeenCalledWith(
      "defmodule Clock do\n  def receive(local, _received), do: local\nend\n",
    );
    expect(screen.getByRole("button", { name: "Copy lib/clock.ex" })).toHaveTextContent("Copied");
  });

  it("says when copying failed, rather than pretending it worked", async () => {
    serves();
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render();

    await user.click(await screen.findByRole("button", { name: "Copy the command" }));

    expect(await screen.findByText("Couldn't copy — select the text instead.")).toBeVisible();
  });

  it("reports a pass with the pasted output, trimmed", async () => {
    serves();
    const bodies = reports();
    const user = userEvent.setup();
    render();

    await user.type(
      await screen.findByLabelText("Paste what your terminal printed (optional)"),
      "  1 test, 0 failures  ",
    );
    await user.click(screen.getByRole("button", { name: "Tests pass" }));

    await waitFor(() => {
      expect(bodies).toEqual([{ passed: true, output: "1 test, 0 failures" }]);
    });
  });

  it("reports 'not yet' with no output as null, not an empty string", async () => {
    serves();
    const bodies = reports();
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole("button", { name: "Not yet" }));

    await waitFor(() => {
      expect(bodies).toEqual([{ passed: false, output: null }]);
    });
  });

  it("shows the server's words when a report does not save", async () => {
    serves();
    server.use(
      http.post(`${API}/lessons/${LESSON}/exercises/:key/reports`, () =>
        problemResponse(409, "exercise-kind-mismatch", "That isn't something this exercise does."),
      ),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole("button", { name: "Tests pass" }));

    expect(await screen.findByText("That isn't something this exercise does.")).toBeVisible();
  });

  it("keeps the solution hidden until asked for, and records opening it", async () => {
    serves();
    let posted = 0;
    server.use(
      http.post(`${API}/lessons/:lessonId/exercises/:key/solution-reveals`, () => {
        posted += 1;
        return HttpResponse.json(
          taskExerciseResponse({
            hints: [
              {
                kind: "solution" as const,
                level: 5,
                rung: "code" as const,
                question: null,
                answer: "x",
                createdAt: "2026-09-24T10:00:00.000Z",
              },
            ],
            nextHintLevel: 5,
          }),
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render();

    const show = await screen.findByRole("button", { name: "Show solution" });
    expect(screen.queryByText(/max\(local, received\) \+ 1/u)).toBeNull();

    await user.click(show);
    expect(await screen.findByText(/max\(local, received\) \+ 1/u)).toBeVisible();
    expect(posted).toBe(1);
  });
});

describe("what a task's history says", () => {
  const withAttempts = (over: Partial<ExerciseAttemptsSummary>) =>
    taskExerciseResponse({ attempts: { ...EMPTY_ATTEMPTS, ...over } });
  const at = "2026-09-24T10:00:00.000Z";
  const fail = { name: "mix test", passed: false, message: null };
  const pass = { name: "mix test", passed: true, message: null };

  it.each([
    ["no reports", withAttempts({}), "Not reported yet"],
    [
      "reports, none passing",
      withAttempts({ count: 2, lastAt: at, lastPassed: false, lastResults: [fail] }),
      "You reported 2 runs, not passing yet",
    ],
    [
      "a pass on the first report",
      withAttempts({
        count: 1,
        firstPassedAt: at,
        lastAt: at,
        lastPassed: true,
        lastResults: [pass],
      }),
      "You reported a pass on the first try",
    ],
    [
      "a pass among several",
      withAttempts({
        count: 3,
        firstPassedAt: at,
        lastAt: at,
        lastPassed: true,
        lastResults: [pass],
      }),
      "You reported a pass · 3 reports in total",
    ],
  ])("with %s, says so in the learner's voice", async (_label, task, text) => {
    serves(task);
    render();

    expect(await screen.findByText(text)).toBeVisible();
  });

  it("says what the last report was, and keeps what was pasted", async () => {
    serves(
      withAttempts({
        count: 1,
        lastAt: at,
        lastPassed: false,
        lastResults: [fail],
        lastCode: "1 test, 1 failure",
      }),
    );
    render();

    expect(await screen.findByText("Last report: not yet")).toBeVisible();
    expect(screen.getByText("What you pasted last time")).toBeVisible();
    expect(screen.getByText("1 test, 1 failure")).toBeInTheDocument();
  });

  it("never says 'passed' without 'reported'", async () => {
    serves(
      withAttempts({
        count: 1,
        firstPassedAt: at,
        lastAt: at,
        lastPassed: true,
        lastResults: [pass],
      }),
    );
    render();
    const region = await screen.findByRole("region", {
      name: "Exercise: A Lamport clock in Elixir",
    });

    // The app saw none of this run; a bare "passed" would claim it had.
    expect(region.textContent).not.toMatch(/(^|[^d] )passed/u);
    expect(region.textContent).toMatch(/You reported a pass/u);
  });
});
