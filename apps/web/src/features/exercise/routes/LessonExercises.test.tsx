import type {
  ExerciseView,
  RecordAttemptInput,
  RequestHintInput,
  RunnerRequest,
} from "@mindforge/core";
import { PYTHON_LOAD_TIMEOUT_MS, RUN_REASONS } from "@mindforge/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exerciseResponse, lessonExercisesResponse } from "../../../test/fixtures.js";
import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { BRIDGE_TIMEOUT_MS, bridgeTimeoutFor } from "../api/use-runner.js";
import { draftKey } from "../model/draft.js";
import { LessonExercises } from "./LessonExercises.js";

/**
 * The exercise beside a lesson (FR-X1–X6), driven end to end inside jsdom.
 *
 * The runner frame cannot load here — jsdom does not fetch another origin — but
 * its `contentWindow` exists, and that is the whole interface: requests are
 * `postMessage` calls on it, answers are `message` events whose `source` is it.
 * So the tests play the runner's part, and the first thing they check is the one
 * that must never regress: the frame is sandboxed to `allow-scripts` and nothing
 * else, because what it runs was written by the agent.
 *
 * CodeMirror is replaced by a textarea. The editor is `CodeEditor`'s concern and
 * has its own test; here it is just where the code comes from.
 */

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

vi.mock("../../../shared/ui/code-editor-impl.js", () => ({
  default: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange?: (value: string) => void;
    label: string;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

const LESSON = "88888888-8888-4888-8888-888888888888";

function serves(exercises: ExerciseView[]) {
  server.use(
    http.get(`${API}/lessons/${LESSON}/exercises`, () =>
      HttpResponse.json(lessonExercisesResponse({ lessonId: LESSON, exercises })),
    ),
  );
}

/** Captures attempt bodies, and answers with the exercise the server would send back. */
function recordsAttempts(answer: (body: RecordAttemptInput) => ExerciseView) {
  const bodies: RecordAttemptInput[] = [];
  server.use(
    http.post(`${API}/lessons/${LESSON}/exercises/:key/attempts`, async ({ request }) => {
      const body = (await request.json()) as RecordAttemptInput;
      bodies.push(body);
      return HttpResponse.json(answer(body));
    }),
  );
  return bodies;
}

function render() {
  return renderWithProviders(<LessonExercises lessonId={LESSON} />);
}

async function runnerFrame(): Promise<HTMLIFrameElement> {
  return screen.findByTitle<HTMLIFrameElement>("Test runner");
}

async function pythonFrame(): Promise<HTMLIFrameElement> {
  return screen.findByTitle<HTMLIFrameElement>("Python test runner");
}

/** Play the runner: send a message *from the frame's window*, as only the real frame can. */
function fromFrame(frame: HTMLIFrameElement, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow }));
  });
}

async function readyRunner() {
  const frame = await runnerFrame();
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  fromFrame(frame, { type: "mindforge:ready" });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Run tests" })).toBeEnabled();
  });
  return { frame, post };
}

function sentRequest(post: {
  readonly mock: { readonly calls: readonly unknown[][] };
}): RunnerRequest {
  expect(post).toHaveBeenCalledTimes(1);
  const [message, target] = post.mock.calls[0]!;
  // An opaque origin cannot be named; `"*"` is the only target that reaches it.
  expect(target).toBe("*");
  return message as RunnerRequest;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the runner frame", () => {
  it("is sandboxed to allow-scripts and nothing else", async () => {
    // It runs tests the agent wrote. `allow-same-origin` beside `allow-scripts`
    // would let it remove its own sandbox (§7.5); it has no use for popups either.
    serves([exerciseResponse()]);
    render();

    const frame = await runnerFrame();

    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame).toHaveAttribute("src", "http://localhost:3001/runner");
  });

  it("ignores a ready message from any window but its own", async () => {
    // A sandboxed lesson on the same page has the same opaque origin as the runner.
    // Only the window identity tells them apart.
    serves([exerciseResponse()]);
    render();
    await runnerFrame();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "mindforge:ready" }, source: window }),
      );
    });

    expect(screen.getByRole("button", { name: "Starting the test runner…" })).toBeDisabled();
  });
});

describe("what renders", () => {
  it("renders nothing at all for a lesson with no exercises", async () => {
    // The reader splits into two columns only when this slot has content, so an
    // empty lesson must leave it empty — not a heading, not a spinner.
    let asked = false;
    server.use(
      http.get(`${API}/lessons/${LESSON}/exercises`, () => {
        asked = true;
        return HttpResponse.json(lessonExercisesResponse({ lessonId: LESSON, exercises: [] }));
      }),
    );
    const { container } = render();

    await waitFor(() => {
      expect(asked).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the task, the starter and an honest history", async () => {
    serves([exerciseResponse()]);
    render();

    expect(await screen.findByRole("heading", { name: "Sum the pairs" })).toBeVisible();
    expect(screen.getByText(/Return one sum per pair/u)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Your code for Sum the pairs" })).toHaveValue(
      "export function sumPairs(pairs) {\n}\n",
    );
    expect(screen.getByText("Not tried yet")).toBeVisible();
  });

  it("says a pass took several attempts without guessing which one passed", async () => {
    serves([
      exerciseResponse({
        attempts: {
          count: 3,
          firstPassedAt: "2026-09-24T10:00:00.000Z",
          lastCode: "x",
          lastPassed: false,
          lastAt: "2026-09-24T10:05:00.000Z",
          lastResults: null,
          lastScene: null,
        },
      }),
    ]);
    render();

    expect(
      await screen.findByText("Passed · 3 attempts in total. The latest run fails."),
    ).toBeVisible();
  });

  it("keeps the solution hidden until asked for", async () => {
    serves([exerciseResponse()]);
    // Opening it is recorded (review #4); the reply carries the reveal.
    server.use(
      http.post(`${API}/lessons/${LESSON}/exercises/:key/solution-reveals`, () =>
        HttpResponse.json(
          exerciseResponse({
            hints: [
              {
                kind: "solution",
                level: 5,
                rung: "code",
                question: null,
                answer: "x",
                createdAt: "2026-09-24T10:00:00.000Z",
              },
            ],
            nextHintLevel: 5,
          }),
          { status: 201 },
        ),
      ),
    );
    render();
    const user = userEvent.setup();

    await screen.findByRole("heading", { name: "Sum the pairs" });
    expect(screen.queryByText("Reference solution")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show solution" }));

    expect(await screen.findByRole("heading", { name: "Reference solution" })).toBeVisible();
    expect(screen.getByText(/pairs\.map/u)).toBeVisible();
  });

  it("offers no solution button when the lesson wrote none", async () => {
    serves([exerciseResponse({ solution: null })]);
    render();

    await screen.findByRole("heading", { name: "Sum the pairs" });
    expect(screen.queryByRole("button", { name: "Show solution" })).not.toBeInTheDocument();
  });

  it("says so when the exercises could not be loaded, and retries", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/lessons/${LESSON}/exercises`, () => {
        calls += 1;
        return calls === 1
          ? problemResponse(500, "internal", "Something broke")
          : HttpResponse.json(lessonExercisesResponse({ lessonId: LESSON }));
      }),
    );
    render();
    const user = userEvent.setup();

    expect(await screen.findByText("Couldn't load this lesson's exercises.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Sum the pairs" })).toBeVisible();
  });
});

describe("a run", () => {
  it("sends the code and the tests to the runner and shows what came back", async () => {
    serves([exerciseResponse()]);
    const bodies = recordsAttempts(() =>
      exerciseResponse({
        attempts: {
          count: 1,
          firstPassedAt: "2026-09-24T10:00:00.000Z",
          lastCode: "export function sumPairs(pairs) {\n}\n",
          lastPassed: true,
          lastAt: "2026-09-24T10:00:00.000Z",
          lastResults: null,
          lastScene: null,
        },
      }),
    );
    render();
    const user = userEvent.setup();
    const { frame, post } = await readyRunner();

    await user.click(screen.getByRole("button", { name: "Run tests" }));

    const request = sentRequest(post);
    expect(request).toMatchObject({
      type: "mindforge:run",
      language: "javascript",
      code: "export function sumPairs(pairs) {\n}\n",
      tests: expect.stringContaining("sumPairs") as string,
    });
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();

    fromFrame(frame, {
      type: "mindforge:result",
      runId: request.runId,
      status: "completed",
      results: [{ name: "sums", passed: true, message: null }],
      message: null,
      logs: ["hello"],
    });

    expect(await screen.findByText("1 of 1 test pass")).toBeVisible();
    expect(screen.getByText("sums")).toBeVisible();
    expect(screen.getByText("Console output (1)")).toBeVisible();
    // The summary is the server's, from the attempt it just recorded.
    expect(await screen.findByText("Passed on the first attempt")).toBeVisible();
    expect(bodies).toEqual([
      {
        code: "export function sumPairs(pairs) {\n}\n",
        status: "completed",
        results: [{ name: "sums", passed: true, message: null }],
        // Never edited, so there is no honest start time to send.
        startedAt: null,
      },
    ]);
  });

  it("ignores answers from elsewhere, to other runs, and that do not parse", async () => {
    serves([exerciseResponse()]);
    recordsAttempts(() => exerciseResponse());
    render();
    const user = userEvent.setup();
    const { frame, post } = await readyRunner();

    await user.click(screen.getByRole("button", { name: "Run tests" }));
    const { runId } = sentRequest(post);
    const answer = {
      type: "mindforge:result",
      runId,
      status: "completed",
      results: [{ name: "forged", passed: true, message: null }],
      message: null,
      logs: [],
    };

    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: answer, source: window }));
    });
    fromFrame(frame, { ...answer, runId: "run-old" });
    fromFrame(frame, { ...answer, status: "passed-honest" });
    fromFrame(frame, "mindforge:result");

    expect(screen.queryByText("forged")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();

    fromFrame(frame, { ...answer, results: [{ name: "real", passed: false, message: "no" }] });
    expect(await screen.findByText("real")).toBeVisible();
    expect(screen.getByText("0 of 1 test pass")).toBeVisible();
  });

  it("reports code that did not load as that, not as a crash", async () => {
    serves([exerciseResponse()]);
    const bodies = recordsAttempts(() => exerciseResponse());
    render();
    const user = userEvent.setup();
    const { frame, post } = await readyRunner();

    await user.click(screen.getByRole("button", { name: "Run tests" }));
    fromFrame(frame, {
      type: "mindforge:result",
      runId: sentRequest(post).runId,
      status: "error",
      reason: "code-syntax",
      results: [],
      message: "SyntaxError: Unexpected token '}'",
      logs: [],
    });

    expect(await screen.findByText("Your code has a syntax error")).toBeVisible();
    expect(screen.getByText("SyntaxError: Unexpected token '}'")).toBeVisible();
    // Recorded anyway: a syntax error on the way to a pass is part of the effort.
    await waitFor(() => {
      expect(bodies.map((b) => b.status)).toEqual(["error"]);
    });
  });

  it("gives up on a runner that never answers, and builds a new one", async () => {
    serves([exerciseResponse()]);
    const bodies = recordsAttempts(() => exerciseResponse());
    render();
    const { frame } = await readyRunner();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    fireEvent.click(screen.getByRole("button", { name: "Run tests" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BRIDGE_TIMEOUT_MS);
    });

    expect(
      await screen.findByText("Stopped after 5 seconds. An infinite loop is the usual cause."),
    ).toBeVisible();
    // A frame that did not answer is not trusted with the next run.
    expect(await runnerFrame()).not.toBe(frame);
    expect(screen.getByRole("button", { name: "Starting the test runner…" })).toBeDisabled();
    await waitFor(() => {
      expect(bodies.map((b) => b.status)).toEqual(["timeout"]);
    });
  });

  it("says when a run finished but the attempt did not save", async () => {
    serves([exerciseResponse()]);
    server.use(
      http.post(`${API}/lessons/${LESSON}/exercises/:key/attempts`, () =>
        problemResponse(500, "internal", "Something broke"),
      ),
    );
    render();
    const user = userEvent.setup();
    const { frame, post } = await readyRunner();

    await user.click(screen.getByRole("button", { name: "Run tests" }));
    fromFrame(frame, {
      type: "mindforge:result",
      runId: sentRequest(post).runId,
      status: "completed",
      results: [{ name: "sums", passed: true, message: null }],
      message: null,
      logs: [],
    });

    expect(
      await screen.findByText("The run finished but wasn't saved. Run again to save it."),
    ).toBeVisible();
  });
});

describe("the code you typed", () => {
  it("sends when you started with the attempt, and keeps a draft on this device", async () => {
    serves([exerciseResponse()]);
    const bodies = recordsAttempts(() => exerciseResponse());
    render();
    const user = userEvent.setup();
    const { frame, post } = await readyRunner();

    const editor = screen.getByRole("textbox", { name: "Your code for Sum the pairs" });
    await user.clear(editor);
    await user.type(editor, "let x = 1");

    await waitFor(() => {
      const stored = window.localStorage.getItem(draftKey(LESSON, "sum-pairs"));
      expect(stored).toContain("let x = 1");
    });

    await user.click(screen.getByRole("button", { name: "Run tests" }));
    fromFrame(frame, {
      type: "mindforge:result",
      runId: sentRequest(post).runId,
      status: "completed",
      results: [],
      message: null,
      logs: [],
    });

    expect(await screen.findByText("The tests ran but checked nothing.")).toBeVisible();
    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]!.code).toBe("let x = 1");
    expect(bodies[0]!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it("resumes from the draft before the last attempt, and resets to the starter", async () => {
    window.localStorage.setItem(
      draftKey(LESSON, "sum-pairs"),
      JSON.stringify({ code: "draft code", startedAt: "2026-09-24T09:00:00.000Z" }),
    );
    serves([
      exerciseResponse({
        attempts: {
          count: 1,
          firstPassedAt: null,
          lastCode: "attempt code",
          lastPassed: false,
          lastAt: "2026-09-24T09:30:00.000Z",
          lastResults: null,
          lastScene: null,
        },
      }),
    ]);
    render();
    const user = userEvent.setup();

    const editor = await screen.findByRole("textbox", { name: "Your code for Sum the pairs" });
    expect(editor).toHaveValue("draft code");

    await user.click(screen.getByRole("button", { name: "Reset to starter" }));
    expect(editor).toHaveValue("export function sumPairs(pairs) {\n}\n");
    expect(screen.getByRole("button", { name: "Reset to starter" })).toBeDisabled();
  });

  it("resumes from the last attempt when this device has no draft", async () => {
    serves([
      exerciseResponse({
        attempts: {
          count: 1,
          firstPassedAt: null,
          lastCode: "attempt code",
          lastPassed: false,
          lastAt: "2026-09-24T09:30:00.000Z",
          lastResults: null,
          lastScene: null,
        },
      }),
    ]);
    render();

    expect(await screen.findByRole("textbox", { name: "Your code for Sum the pairs" })).toHaveValue(
      "attempt code",
    );
  });

  it("still works when this browser refuses storage", async () => {
    // A private window, blocked site data, a full quota: every access throws. The
    // exercise must not be lost over a convenience.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "QuotaExceededError");
    });
    serves([exerciseResponse()]);
    render();
    const user = userEvent.setup();

    const editor = await screen.findByRole("textbox", { name: "Your code for Sum the pairs" });
    await user.type(editor, "// more");
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(editor).toHaveValue("export function sumPairs(pairs) {\n}\n// more");
  });

  it("ignores a stored draft that is not the shape it wrote", async () => {
    window.localStorage.setItem(draftKey(LESSON, "sum-pairs"), '{"code": 42}');
    serves([exerciseResponse()]);
    render();

    expect(await screen.findByRole("textbox", { name: "Your code for Sum the pairs" })).toHaveValue(
      "export function sumPairs(pairs) {\n}\n",
    );
  });
});

describe("hints", () => {
  const HINT = {
    kind: "hint" as const,
    level: 1,
    rung: "question" as const,
    question: null,
    answer: "Which way is the list sorted?",
    createdAt: "2026-09-24T10:00:00.000Z",
  };

  /** Captures hint bodies, and answers with what the server would send back. */
  function givesHints(answer: (body: RequestHintInput) => ExerciseView) {
    const bodies: RequestHintInput[] = [];
    server.use(
      http.post(`${API}/lessons/${LESSON}/exercises/:key/hints`, async ({ request }) => {
        const body = (await request.json()) as RequestHintInput;
        bodies.push(body);
        return HttpResponse.json(answer(body), { status: 201 });
      }),
    );
    return bodies;
  }

  it("names the next rung before it is asked for", async () => {
    serves([exerciseResponse()]);
    render();

    expect(await screen.findByRole("button", { name: "Get a hint: a question" })).toBeVisible();
  });

  it("asks at the server's next rung with the code in the editor, and shows the answer", async () => {
    serves([exerciseResponse()]);
    const bodies = givesHints(() => exerciseResponse({ hints: [HINT], nextHintLevel: 2 }));
    const user = userEvent.setup();
    render();

    const editor = await screen.findByLabelText("Your code for Sum the pairs");
    await user.clear(editor);
    await user.type(editor, "// not run yet");
    await user.click(screen.getByRole("button", { name: "Get a hint: a question" }));

    expect(await screen.findByText("Which way is the list sorted?")).toBeVisible();
    expect(screen.getByText("Hint 1 of 5 · a question")).toBeVisible();
    // The code the learner is stuck on, not the last attempt; and no run to report.
    expect(bodies[0]).toEqual({ level: 1, code: "// not run yet", lastRun: null, question: null });
    // The ladder moved because the server said so.
    expect(screen.getByRole("button", { name: "Get a hint: a clue" })).toBeVisible();
  });

  it("answers the learner's own question at the rung they are on, not one higher", async () => {
    serves([exerciseResponse({ hints: [HINT], nextHintLevel: 2 })]);
    const bodies = givesHints(() =>
      exerciseResponse({
        hints: [HINT, { ...HINT, question: "Why descending?", answer: "Think about the median." }],
        nextHintLevel: 2,
      }),
    );
    const user = userEvent.setup();
    render();

    await user.type(await screen.findByLabelText("Or ask about this exercise"), "Why descending?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText("Think about the median.")).toBeVisible();
    expect(screen.getByText("You asked: Why descending?")).toBeVisible();
    expect(bodies[0]).toMatchObject({ level: 1, question: "Why descending?" });
  });

  it("says in the server's words why no hint came back", async () => {
    serves([exerciseResponse()]);
    server.use(
      http.post(`${API}/lessons/${LESSON}/exercises/:key/hints`, () =>
        problemResponse(
          409,
          "teach-daily-budget-exhausted",
          "You've reached the $15.00 daily limit for generating lessons.",
        ),
      ),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole("button", { name: "Get a hint: a question" }));

    expect(await screen.findByText(/daily limit/u)).toBeVisible();
  });

  it("says how much help a pass took, beside the attempts", async () => {
    serves([
      exerciseResponse({
        attempts: {
          count: 1,
          firstPassedAt: "2026-09-24T10:05:00.000Z",
          lastCode: "x",
          lastPassed: true,
          lastAt: "2026-09-24T10:05:00.000Z",
          lastResults: null,
          lastScene: null,
        },
        hints: [HINT, { ...HINT, level: 5, rung: "code" }],
        nextHintLevel: 5,
      }),
    ]);
    render();

    // A pass after being shown the code is not the same result as one worked out
    // alone, and the summary does not let them look alike.
    expect(
      await screen.findByText("Passed on the first attempt · hints up to the code"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Another hint: the code" })).toBeVisible();
  });

  it("says nothing about hints when none were asked for, rather than 'no hints'", async () => {
    serves([exerciseResponse()]);
    render();

    expect(await screen.findByText("Not tried yet")).toBeVisible();
    expect(screen.queryByText(/hints up to/u)).toBeNull();
  });
});

describe("how the lesson landed", () => {
  it("says it once the lesson is judged, with what it was based on", async () => {
    server.use(
      http.get(`${API}/lessons/${LESSON}/exercises`, () =>
        HttpResponse.json(
          lessonExercisesResponse({
            lessonId: LESSON,
            strain: { verdict: "too-hard", reasons: ["never-passed"] },
          }),
        ),
      ),
    );
    render();

    expect(
      await screen.findByText("How this landed: too hard — never passed the exercise."),
    ).toBeInTheDocument();
  });

  it("says nothing while the lesson is in progress", async () => {
    serves([exerciseResponse()]);
    render();

    await screen.findByText("Sum the pairs");
    expect(screen.queryByText(/How this landed/u)).not.toBeInTheDocument();
  });
});

describe("Python", () => {
  const pythonExercise = () =>
    exerciseResponse({
      key: "lamport-receive",
      title: "A Lamport clock, on receive",
      language: "python",
      starter: "def on_receive(local, received):\n    return local\n",
      tests: "from solution import on_receive\ndef test_x():\n    assert on_receive(3, 7) == 8\n",
    });

  it("starts Python as soon as the runner is listening, before the first run", async () => {
    serves([pythonExercise()]);
    render();
    const frame = await pythonFrame();
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    fromFrame(frame, { type: "mindforge:ready" });

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith({ type: "mindforge:warm", language: "python" }, "*");
    });
  });

  it("does not start Python for a lesson with none", async () => {
    serves([exerciseResponse()]);
    render();
    const frame = await runnerFrame();
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    fromFrame(frame, { type: "mindforge:ready" });
    await screen.findByRole("button", { name: "Run tests" });

    expect(post).not.toHaveBeenCalled();
  });

  it("waits out Python's start before giving up on a run", async () => {
    // A first Python run includes starting the interpreter, which the runner bounds
    // with its own clock. Giving up at the JavaScript deadline would tear down a
    // frame that was about to answer — on exactly the learner's first run.
    serves([pythonExercise()]);
    recordsAttempts(() => pythonExercise());
    render();
    const frame = await pythonFrame();
    fromFrame(frame, { type: "mindforge:ready" });
    const run = await screen.findByRole("button", { name: "Run tests" });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    fireEvent.click(run);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BRIDGE_TIMEOUT_MS + 1_000);
    });
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PYTHON_LOAD_TIMEOUT_MS);
    });
    expect(
      await screen.findByText("Stopped after 5 seconds. An infinite loop is the usual cause."),
    ).toBeVisible();
  });

  it("says the first run takes a moment, until there has been one", async () => {
    serves([pythonExercise()]);
    const { unmount } = render();

    expect(await screen.findByText(/first Python run takes a few seconds/u)).toBeVisible();
    unmount();

    serves([
      exerciseResponse({
        ...pythonExercise(),
        attempts: {
          ...pythonExercise().attempts,
          count: 1,
          lastCode: "x",
          lastAt: "2026-09-24T10:00:00.000Z",
          lastPassed: false,
        },
      }),
    ]);
    render();
    await screen.findByRole("region", { name: "Exercise: A Lamport clock, on receive" });
    expect(screen.queryByText(/first Python run takes a few seconds/u)).toBeNull();
  });
});

describe("bridgeTimeoutFor", () => {
  it("adds Python's start to its deadline, and only Python's", () => {
    expect(bridgeTimeoutFor("javascript")).toBe(BRIDGE_TIMEOUT_MS);
    expect(bridgeTimeoutFor("typescript")).toBe(BRIDGE_TIMEOUT_MS);
    expect(bridgeTimeoutFor("python")).toBe(BRIDGE_TIMEOUT_MS + PYTHON_LOAD_TIMEOUT_MS);
  });
});

describe("which runner a lesson loads (review #9)", () => {
  const python = () =>
    exerciseResponse({
      key: "py",
      title: "Py",
      language: "python",
      starter: "",
      tests: "def test_x(): pass",
    });

  it("runs Python on the Python page, and loads no JavaScript runner for a Python-only lesson", async () => {
    serves([python()]);
    render();

    const frame = await pythonFrame();
    expect(frame).toHaveAttribute("src", "http://localhost:3001/runner/python");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(screen.queryByTitle("Test runner")).toBeNull();
  });

  it("loads only the JavaScript runner, under connect-src 'none', for a JavaScript-only lesson", async () => {
    serves([exerciseResponse()]);
    render();

    expect(await runnerFrame()).toHaveAttribute("src", "http://localhost:3001/runner");
    expect(screen.queryByTitle("Python test runner")).toBeNull();
  });

  it("loads both for a mixed lesson, and sends each run to its own", async () => {
    serves([exerciseResponse(), python()]);
    render();
    const js = await runnerFrame();
    const py = await pythonFrame();
    const jsPost = vi.spyOn(js.contentWindow!, "postMessage");
    const pyPost = vi.spyOn(py.contentWindow!, "postMessage");
    fromFrame(js, { type: "mindforge:ready" });
    fromFrame(py, { type: "mindforge:ready" });

    // The warm-up goes to the Python page only.
    await waitFor(() => {
      expect(pyPost).toHaveBeenCalledWith({ type: "mindforge:warm", language: "python" }, "*");
    });
    expect(jsPost).not.toHaveBeenCalled();

    const [jsRun, pyRun] = await screen.findAllByRole("button", { name: "Run tests" });
    fireEvent.click(pyRun!);
    await waitFor(() => {
      expect(pyPost).toHaveBeenCalledWith(expect.objectContaining({ language: "python" }), "*");
    });
    fireEvent.click(jsRun!);
    await waitFor(() => {
      expect(jsPost).toHaveBeenCalledWith(expect.objectContaining({ language: "javascript" }), "*");
    });
  });
});

describe("a run that never happened (review #5)", () => {
  it("records nothing when the panel goes away mid-run", async () => {
    serves([exerciseResponse()]);
    const bodies = recordsAttempts(() => exerciseResponse());
    const { unmount } = render();
    await readyRunner();

    fireEvent.click(screen.getByRole("button", { name: "Run tests" }));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(bodies).toEqual([]);
  });
});

describe("why a run did not complete (review #8)", () => {
  it("says it in the learner's words, with the raw detail beneath", async () => {
    serves([exerciseResponse()]);
    recordsAttempts(() => exerciseResponse());
    render();
    const { frame, post } = await readyRunner();

    fireEvent.click(screen.getByRole("button", { name: "Run tests" }));
    const { runId } = sentRequest(post);
    fromFrame(frame, {
      type: "mindforge:result",
      runId,
      status: "error",
      reason: "tests-load",
      results: [],
      message: "ImportError: cannot import name 'x'",
      logs: [],
    });

    expect(await screen.findByText("The exercise's tests didn't load")).toBeVisible();
    expect(screen.getByText("ImportError: cannot import name 'x'")).toBeVisible();
  });

  it("has words for every reason the runner can give, in both languages", async () => {
    const en = (await import("../../../locales/en/exercise.json")).default as {
      result: { reason: Record<string, string> };
    };
    const pt = (await import("../../../locales/pt-BR/exercise.json")).default as {
      result: { reason: Record<string, string> };
    };

    for (const reason of RUN_REASONS) {
      expect(en.result.reason[reason], reason).toBeTruthy();
      expect(pt.result.reason[reason], reason).toBeTruthy();
    }
  });
});

describe("opening the solution (review #4)", () => {
  const withSolution = (hints: ExerciseView["hints"] = []) =>
    exerciseResponse({ solution: "export function sumPairs() {}", hints, nextHintLevel: 1 });
  const REVEALED = {
    kind: "solution" as const,
    level: 5,
    rung: "code" as const,
    question: null,
    answer: "export function sumPairs() {}",
    createdAt: "2026-09-24T10:00:00.000Z",
  };

  it("records opening it before showing it, and says that it will", async () => {
    serves([withSolution()]);
    let posted = 0;
    server.use(
      http.post(`${API}/lessons/${LESSON}/exercises/:key/solution-reveals`, () => {
        posted += 1;
        return HttpResponse.json(withSolution([REVEALED]), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render();

    expect(await screen.findByText("Opening it is recorded as help.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show solution" }));

    expect(await screen.findByRole("heading", { name: "Reference solution" })).toBeVisible();
    expect(posted).toBe(1);

    // Hiding and showing again asks nothing new.
    await user.click(screen.getByRole("button", { name: "Hide solution" }));
    await user.click(screen.getByRole("button", { name: "Show solution" }));
    expect(posted).toBe(1);
  });

  it("does not show it when the reveal could not be recorded", async () => {
    serves([withSolution()]);
    server.use(
      http.post(`${API}/lessons/${LESSON}/exercises/:key/solution-reveals`, () =>
        problemResponse(409, "solution-unavailable", "This exercise has no reference solution."),
      ),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole("button", { name: "Show solution" }));

    expect(await screen.findByText("This exercise has no reference solution.")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Reference solution" })).toBeNull();
  });

  it("lists it as the solution opened, not as a hint with the answer in it", async () => {
    serves([withSolution([REVEALED])]);
    render();

    expect(await screen.findByText("You opened the reference solution")).toBeVisible();
    expect(screen.queryByText("Hint 5 of 5 · the code")).toBeNull();
  });

  it("names it in the summary, rather than 'hints up to the code'", async () => {
    serves([
      exerciseResponse({
        solution: "x",
        hints: [REVEALED],
        attempts: {
          count: 1,
          firstPassedAt: "2026-09-24T10:05:00.000Z",
          lastCode: "x",
          lastPassed: true,
          lastAt: "2026-09-24T10:05:00.000Z",
          lastResults: null,
          lastScene: null,
        },
      }),
    ]);
    render();

    expect(
      await screen.findByText("Passed on the first attempt · reference solution opened"),
    ).toBeVisible();
  });
});
