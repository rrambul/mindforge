import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import type { Lesson } from "../api/use-lesson.js";
import { LessonRoute } from "./LessonRoute.js";

/**
 * The lesson reader (FR-T5, FR-P1).
 *
 * The first test is the one that matters most and it is not about behaviour at all:
 * `allow-scripts` together with `allow-same-origin` lets the frame remove its own
 * sandbox attribute, and lesson HTML is LLM-authored JavaScript. If that assertion
 * ever has to be "fixed" to make a lesson work, the fix is wrong.
 *
 * The rest are about the outcome: three chips, one tap, and a screen that never
 * claims a lesson was understood when nothing was recorded.
 */

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const LESSON = "88888888-8888-4888-8888-888888888888";
const MISSION = "11111111-1111-4111-8111-111111111111";
const URL_ = "http://localhost:3001/v/token.sig/lessons/0007-borrow-checker.html";

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: LESSON,
    missionId: MISSION,
    trackId: "track-1",
    moduleName: "Ownership in practice",
    slug: "borrow-checker",
    title: "Borrow checker errors",
    intent: "Read the error, not the code",
    status: "generated",
    difficulty: 4,
    depth: "deep_dive",
    seq: 7,
    completedAt: null,
    outcome: null,
    view: { url: URL_, expiresAt: "2026-08-10T10:00:00.000Z" },
    ...over,
  };
}

function returns(body: Lesson) {
  server.use(http.get(`${API}/lessons/${LESSON}`, () => HttpResponse.json(body)));
}

function render() {
  renderWithProviders(<LessonRoute lessonId={LESSON} />);
}

describe("the frame", () => {
  it("never grants the lesson its own origin", async () => {
    // `allow-scripts` + `allow-same-origin` lets the frame reach `frameElement` and
    // delete the sandbox attribute, which defeats the whole mechanism. This is the
    // one combination that must never appear (§7.5).
    returns(lesson());
    render();

    const frame = await screen.findByTitle(/Borrow checker errors/u);
    const sandbox = frame.getAttribute("sandbox") ?? "";

    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  it("points at the URL the API minted, on the lessons origin", async () => {
    returns(lesson());
    render();

    expect(await screen.findByTitle(/Borrow checker errors/u)).toHaveAttribute("src", URL_);
  });

  it("says a planned lesson has not been written, rather than showing an error", async () => {
    // The lesson exists as an intention. That is an invitation to have it taught,
    // and an error page is not.
    returns(lesson({ status: "planned", view: null, seq: null }));
    render();

    expect(await screen.findByText(/hasn't been written/u)).toBeInTheDocument();
    expect(screen.queryByTitle(/Borrow checker errors/u)).not.toBeInTheDocument();
  });

  it("says an unwritten lesson has nothing to have been understood", async () => {
    returns(lesson({ status: "planned", view: null, seq: null }));
    render();

    expect(await screen.findByText(/nothing to have understood/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Understood" })).not.toBeInTheDocument();
  });
});

describe("recording how it went", () => {
  it("takes one tap, with no confirmation in the way", async () => {
    returns(lesson());

    let sent: unknown = null;
    server.use(
      http.put(`${API}/lessons/${LESSON}/completion`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(lesson({ outcome: "shaky", completedAt: "2026-08-10T09:00:00Z" }));
      }),
    );

    render();
    await userEvent.click(await screen.findByRole("button", { name: "Shaky" }));

    expect(sent).toEqual({ outcome: "shaky" });
    expect(await screen.findByText(/Recorded as Shaky/u)).toBeInTheDocument();
  });

  it("shows the recorded outcome as pressed, so the chips are the state", async () => {
    returns(lesson({ outcome: "understood", completedAt: "2026-08-10T09:00:00Z" }));
    render();

    expect(await screen.findByRole("button", { name: "Understood", pressed: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Lost", pressed: false })).toBeVisible();
  });

  it("does not call shaky a failure, or nudge towards understood", async () => {
    // Honesty over encouragement: the hint says shaky is the common answer, and the
    // chips carry no tone that would push you off it.
    returns(lesson());
    render();

    expect(await screen.findByText(/Shaky is the honest answer/u)).toBeInTheDocument();
  });

  it("offers an undo once something is recorded, and not before", async () => {
    returns(lesson());
    render();

    await screen.findByRole("button", { name: "Shaky" });
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();

    server.use(
      http.put(`${API}/lessons/${LESSON}/completion`, () =>
        HttpResponse.json(lesson({ outcome: "lost", completedAt: "2026-08-10T09:00:00Z" })),
      ),
      http.delete(`${API}/lessons/${LESSON}/completion`, () => HttpResponse.json(lesson())),
    );

    await userEvent.click(screen.getByRole("button", { name: "Lost" }));
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });
  });

  it("says so when the write is refused, and keeps the lesson on screen", async () => {
    returns(lesson());
    server.use(
      http.put(`${API}/lessons/${LESSON}/completion`, () =>
        problemResponse(409, "lesson-not-written", "This lesson hasn't been written yet."),
      ),
    );

    render();
    await userEvent.click(await screen.findByRole("button", { name: "Understood" }));

    expect(await screen.findByText("This lesson hasn't been written yet.")).toBeInTheDocument();
    expect(screen.getByTitle(/Borrow checker errors/u)).toBeInTheDocument();
  });
});

describe("what the page says about the lesson", () => {
  it("names the module, the difficulty and the depth", async () => {
    returns(lesson());
    render();

    expect(await screen.findByText("Ownership in practice")).toBeInTheDocument();
    expect(screen.getByText(/Difficulty 4 of 5/u)).toBeInTheDocument();
    expect(screen.getByText(/Deep dive/u)).toBeInTheDocument();
  });

  it("says a missing difficulty is unrecorded rather than showing a middling number", async () => {
    // A 3 in place of nothing is a measurement claim about something the plan never
    // stated (non-negotiable 10).
    returns(lesson({ difficulty: null, depth: null }));
    render();

    expect(await screen.findByText(/Difficulty not recorded/u)).toBeInTheDocument();
    expect(screen.getByText(/Depth not recorded/u)).toBeInTheDocument();
  });

  it("offers a retry when the lesson cannot be loaded", async () => {
    server.use(
      http.get(`${API}/lessons/${LESSON}`, () =>
        problemResponse(404, "lesson-not-found", "That lesson no longer exists."),
      ),
    );

    render();
    expect(await screen.findByText("That lesson no longer exists.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
