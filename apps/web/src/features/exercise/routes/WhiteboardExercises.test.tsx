import type { RequestReviewInput, SceneElement } from "@mindforge/core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WhiteboardHandle, WhiteboardProps } from "../../../shared/ui/Whiteboard.js";
import {
  EMPTY_ATTEMPTS,
  exerciseResponse,
  lessonExercisesResponse,
  whiteboardExerciseResponse,
} from "../../../test/fixtures.js";
import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { sceneDraftKey } from "../model/scene-draft.js";
import { LessonExercises } from "./LessonExercises.js";

/**
 * A design exercise beside a lesson (FR-X7–X9).
 *
 * The canvas is replaced by a stub with the same props and the same handle: the
 * drawing library is `Whiteboard`'s concern, and here it is only where elements
 * come from and where an image is exported. What these tests hold on to is the
 * contract around it — the rubric appears only once the server sends it, the
 * feedback is labelled for what it is, and a drawing that cannot be sent says so.
 */

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const BOX: SceneElement = { id: "api", type: "rectangle" };
let canvasElements: SceneElement[] = [];
const exportPng = vi.fn<(side: number) => Promise<string>>();
const opened: (readonly SceneElement[])[] = [];

vi.mock("../../../shared/ui/whiteboard-impl.js", () => ({
  default: ({ initialElements, onChange, onReady, label }: WhiteboardProps) => {
    useEffect(() => {
      opened.push(initialElements);
      canvasElements = [...initialElements];
      const handle: WhiteboardHandle = { elements: () => canvasElements, exportPng };
      onReady?.(handle);
      return () => {
        onReady?.(null);
      };
      // Mount only, like the real canvas reads its initial scene once.
    }, []);
    return (
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          canvasElements = [...canvasElements, { ...BOX, id: `box-${canvasElements.length}` }];
          onChange?.(canvasElements);
        }}
      >
        draw a box
      </button>
    );
  },
}));

const LESSON = "88888888-8888-4888-8888-888888888888";
const PNG = "data:image/png;base64,AAAA";

function serves(exercises: ReturnType<typeof whiteboardExerciseResponse>[] | unknown[]) {
  server.use(
    http.get(`${API}/lessons/${LESSON}/exercises`, () =>
      HttpResponse.json(
        lessonExercisesResponse({ lessonId: LESSON, exercises: exercises as never }),
      ),
    ),
  );
}

const REVIEWED = whiteboardExerciseResponse({
  rubric: ["Separates reads from writes", "Caches hot redirects"],
  solution: "A write service, a read service and a cache in front of the read path.",
  attempts: {
    ...EMPTY_ATTEMPTS,
    count: 1,
    lastAt: "2026-09-24T10:00:00.000Z",
    lastPassed: false,
    lastResults: [
      {
        name: "Separates reads from writes",
        passed: true,
        message: "Two services.",
        verdict: "covered",
      },
      {
        name: "Caches hot redirects",
        passed: false,
        message: "No cache drawn.",
        verdict: "missing",
      },
    ],
    lastScene: [BOX],
  },
});

function reviews(answer: () => ReturnType<typeof whiteboardExerciseResponse>) {
  const bodies: RequestReviewInput[] = [];
  server.use(
    http.post(`${API}/lessons/${LESSON}/exercises/:key/reviews`, async ({ request }) => {
      bodies.push((await request.json()) as RequestReviewInput);
      return HttpResponse.json(answer(), { status: 201 });
    }),
  );
  return bodies;
}

const render = () => renderWithProviders(<LessonExercises lessonId={LESSON} />);
const canvas = () => screen.findByRole("button", { name: "Whiteboard for Design a URL shortener" });

beforeEach(() => {
  window.localStorage.clear();
  canvasElements = [];
  opened.length = 0;
  exportPng.mockReset();
  exportPng.mockResolvedValue(PNG);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("before the first review", () => {
  it("shows the task and an honest history, and no checklist to draw towards", async () => {
    serves([whiteboardExerciseResponse()]);
    render();

    expect(await screen.findByText("Draw the write path and the read path.")).toBeVisible();
    expect(screen.getByText("Not reviewed yet")).toBeVisible();
    expect(screen.queryByText("Feedback")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show reference design" })).toBeNull();
  });

  it("cannot be sent for review with nothing drawn", async () => {
    serves([whiteboardExerciseResponse()]);
    render();
    await canvas();

    expect(screen.getByRole("button", { name: "Draw your design first" })).toBeDisabled();
  });

  it("offers no hints and loads no test runner", async () => {
    // Hints are for code for now, and a lesson with nothing to run starts no runner.
    serves([whiteboardExerciseResponse()]);
    render();
    await canvas();

    expect(screen.queryByTitle("Test runner")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Get a hint/u })).toBeNull();
  });
});

describe("sending a design for review", () => {
  it("sends the drawn elements, the image and when the drawing started", async () => {
    serves([whiteboardExerciseResponse()]);
    const bodies = reviews(() => REVIEWED);
    const user = userEvent.setup();
    render();

    await user.click(await canvas());
    await user.click(screen.getByRole("button", { name: "Get feedback" }));

    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toEqual({
      elements: [{ id: "box-0", type: "rectangle" }],
      image: PNG,
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u) as string,
    });
    expect(exportPng).toHaveBeenCalledWith(1600);
  });

  it("tries a smaller image once when the first is too large", async () => {
    serves([whiteboardExerciseResponse()]);
    const bodies = reviews(() => REVIEWED);
    exportPng.mockResolvedValueOnce("x".repeat(4_000_001)).mockResolvedValueOnce(PNG);
    const user = userEvent.setup();
    render();

    await user.click(await canvas());
    await user.click(screen.getByRole("button", { name: "Get feedback" }));

    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(exportPng.mock.calls.map(([side]) => side)).toEqual([1600, 1000]);
  });

  it("says a drawing is too large rather than sending a broken one", async () => {
    serves([whiteboardExerciseResponse()]);
    const bodies = reviews(() => REVIEWED);
    exportPng.mockResolvedValue("x".repeat(4_000_001));
    const user = userEvent.setup();
    render();

    await user.click(await canvas());
    await user.click(screen.getByRole("button", { name: "Get feedback" }));

    expect(await screen.findByText(/too large to send for review/u)).toBeVisible();
    expect(bodies).toEqual([]);
  });

  it("says in the server's words why no review came back", async () => {
    serves([whiteboardExerciseResponse()]);
    server.use(
      http.post(`${API}/lessons/${LESSON}/exercises/:key/reviews`, () =>
        problemResponse(503, "reviews-unavailable", "Reviews aren't available on this install."),
      ),
    );
    const user = userEvent.setup();
    render();

    await user.click(await canvas());
    await user.click(screen.getByRole("button", { name: "Get feedback" }));

    expect(await screen.findByText("Reviews aren't available on this install.")).toBeVisible();
  });
});

describe("after a review", () => {
  it("shows each rubric item with its verdict and note, labelled as AI feedback, not a grade", async () => {
    serves([REVIEWED]);
    render();

    expect(await screen.findByText(/it is not a grade/u)).toBeVisible();
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-verdict"))).toEqual(["covered", "missing"]);
    expect(screen.getByText("Covered")).toBeVisible();
    expect(screen.getByText("Missing")).toBeVisible();
    expect(screen.getByText("No cache drawn.")).toBeVisible();
    expect(screen.getByText("Reviewed 1 time, not all covered yet")).toBeVisible();
  });

  it("shows the reference design only when asked, once opening it is recorded", async () => {
    serves([REVIEWED]);
    let posted = 0;
    server.use(
      http.post(`${API}/lessons/:lessonId/exercises/:key/solution-reveals`, () => {
        posted += 1;
        return HttpResponse.json(
          {
            ...REVIEWED,
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
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole("button", { name: "Show reference design" }));

    expect(await screen.findByText(/a cache in front of the read path/u)).toBeVisible();
    expect(posted).toBe(1);
  });

  it("reopens the canvas on the drawing it reviewed", async () => {
    serves([REVIEWED]);
    render();
    await canvas();

    expect(opened[0]).toEqual([BOX]);
  });

  it("says when every item was covered, and how many reviews it took", async () => {
    serves([
      whiteboardExerciseResponse({
        attempts: {
          ...REVIEWED.attempts,
          count: 3,
          firstPassedAt: "2026-09-24T10:30:00.000Z",
          lastPassed: true,
        },
      }),
    ]);
    render();

    expect(await screen.findByText("All covered · 3 reviews in total")).toBeVisible();
  });
});

describe("the draft", () => {
  it("prefers this device's unsent drawing over the last reviewed one", async () => {
    const newer: SceneElement = { id: "cache", type: "ellipse" };
    window.localStorage.setItem(
      sceneDraftKey(LESSON, "url-shortener"),
      JSON.stringify({ elements: [newer], startedAt: null }),
    );
    serves([REVIEWED]);
    render();
    await canvas();

    expect(opened[0]).toEqual([newer]);
  });

  it("still opens when this browser's storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    serves([REVIEWED]);
    render();
    await canvas();

    expect(opened[0]).toEqual([BOX]);
  });
});

describe("a lesson with both kinds", () => {
  it("loads the runner for its code and a canvas for its design", async () => {
    serves([exerciseResponse(), whiteboardExerciseResponse()]);
    render();

    expect(await screen.findByTitle("Test runner")).toBeInTheDocument();
    expect(await canvas()).toBeVisible();
  });
});

describe("the code panel", () => {
  it("shows the last run's results after a reload, and says they are from then", async () => {
    serves([
      exerciseResponse({
        attempts: {
          ...EMPTY_ATTEMPTS,
          count: 1,
          lastCode: "x",
          lastPassed: false,
          lastAt: "2026-09-24T10:00:00.000Z",
          lastResults: [{ name: "sums", passed: false, message: "expected 0 to be 3" }],
        },
      }),
    ]);
    render();

    expect(await screen.findByText("From your last run:")).toBeVisible();
    expect(screen.getByText("expected 0 to be 3")).toBeVisible();
  });
});
