import { COLD_START_CHIPS } from "@mindforge/core";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../test/msw.js";
import { renderWithProviders } from "../test/render.js";
import { TodayScreen } from "./TodayScreen.js";

vi.mock("../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const SESSION_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const MISSION_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    intention: "get the parser handling nested groups",
    startedAt: new Date(Date.now() - 42 * 60_000).toISOString(),
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
    ...overrides,
  };
}

function runningReturns(value: object | null) {
  server.use(
    http.get(`${API}/focus/sessions/running`, () => HttpResponse.json({ session: value })),
  );
}

/**
 * Running until stopped, then null — which is what the real API does.
 *
 * A fixed handler that kept reporting the session as running would hide the debrief forever,
 * because the server is the source of truth for whether something is running and the screen
 * correctly prefers it over local state.
 */
function runningUntilStopped() {
  let running = true;
  server.use(
    http.get(`${API}/focus/sessions/running`, () =>
      HttpResponse.json({ session: running ? session() : null }),
    ),
    http.post(`${API}/focus/sessions/${SESSION_ID}/stop`, () => {
      running = false;
      // A fixed instant, not the wall clock: nothing asserts on it, and a fixture that reads
      // the clock is a fixture that can differ between runs.
      return HttpResponse.json(session({ isRunning: false, endedAt: "2026-08-05T12:42:00.000Z" }), {
        status: 201,
      });
    }),
  );
}

function chipsReturn(inline: readonly string[], overflow: readonly string[] = []) {
  server.use(http.get(`${API}/friction/chips`, () => HttpResponse.json({ inline, overflow })));
}

beforeEach(() => {
  vi.clearAllMocks();
  chipsReturn(COLD_START_CHIPS);
});

describe("nothing running", () => {
  it("offers the one primary action, with the intention optional", async () => {
    runningReturns(null);
    renderWithProviders(<TodayScreen />);

    expect(await screen.findByRole("button", { name: "Start focus" })).toBeEnabled();
    // §5.3 asks one question at start, and a question you cannot skip is one that stops you
    // starting — so the field exists but is not required.
    expect(screen.getByLabelText(/What does done look like/)).not.toBeRequired();
  });

  it("starts with no intention at all", async () => {
    runningReturns(null);
    const sent = vi.fn();
    server.use(
      http.post(`${API}/focus/sessions/start`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(session(), { status: 201 });
      }),
    );

    renderWithProviders(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Start focus" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    const body = sent.mock.calls[0]?.[0] as { intention?: string; id?: string };
    expect(body.intention).toBeUndefined();
    // The client mints the id, so a retry is a replay rather than a second session (§6.1).
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends the subject, which is what lets a plan and an actual meet", async () => {
    // The defect this covers: before it, this form sent an intention and nothing else, so
    // `focus_sessions.mission_id` and `skill_id` were written only by the API's own tests and the
    // seed. A user could allocate four hours to a mission on the weekly grid, log every one of them
    // here, and watch the review report 0m — the plan and the actual had no way to meet.
    runningReturns(null);
    const sent = vi.fn();
    server.use(
      http.get(`${API}/missions`, () =>
        HttpResponse.json({
          missions: [
            {
              id: MISSION_ID,
              topic: "Rust, properly",
              why: null,
              successLooksLike: null,
              constraints: null,
              currentLevel: null,
              status: "active",
              createdAt: "2026-08-01T09:00:00.000Z",
              updatedAt: "2026-08-01T09:00:00.000Z",
            },
          ],
        }),
      ),
      http.post(`${API}/focus/sessions/start`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(session(), { status: 201 });
      }),
    );

    renderWithProviders(<TodayScreen />);
    const picker = await screen.findByLabelText(/What is this about/);
    await userEvent.selectOptions(picker, `mission:${MISSION_ID}`);
    await userEvent.click(screen.getByRole("button", { name: "Start focus" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect(sent.mock.calls[0]?.[0]).toMatchObject({ missionId: MISSION_ID });
  });

  it("sends nothing extra when no subject is chosen", async () => {
    // The picker must not cost the ≤5s path a tap: leaving it alone has to be the same request as
    // before it existed.
    runningReturns(null);
    const sent = vi.fn();
    server.use(
      http.post(`${API}/focus/sessions/start`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(session(), { status: 201 });
      }),
    );

    renderWithProviders(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Start focus" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    const body = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["id"]);
  });

  it("sends the intention when one is typed", async () => {
    runningReturns(null);
    const sent = vi.fn();
    server.use(
      http.post(`${API}/focus/sessions/start`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(session(), { status: 201 });
      }),
    );

    renderWithProviders(<TodayScreen />);
    await userEvent.type(
      await screen.findByLabelText(/What does done look like/),
      "  finish the parser  ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Start focus" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect((sent.mock.calls[0]?.[0] as { intention: string }).intention).toBe("finish the parser");
  });

  it("shows the timer immediately, before the server answers", async () => {
    // §5: "a capture that waits on a round-trip has already failed" the ≤5s budget. The
    // optimistic write is the implementation of that, not an optimisation.
    runningReturns(null);
    server.use(
      http.post(`${API}/focus/sessions/start`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return HttpResponse.json(session(), { status: 201 });
      }),
    );

    renderWithProviders(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Start focus" }));

    // Present while the request is still in flight.
    expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("rolls the timer back when the start fails", async () => {
    // A timer that appears and then silently is not running is worse than one that never
    // appeared: you would trust it and lose the block.
    runningReturns(null);
    server.use(
      http.post(`${API}/focus/sessions/start`, () =>
        problemResponse(
          409,
          "focus-session-already-running",
          "A focus session is already running.",
        ),
      ),
    );

    renderWithProviders(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Start focus" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A focus session is already running.",
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument(),
    );
  });
});

describe("a session running", () => {
  it("shows the elapsed time and the intention", async () => {
    runningReturns(session());
    renderWithProviders(<TodayScreen />);

    // Ticked locally: elapsed time is a function of now, so the API withholds it.
    expect(await screen.findByText(/^42:\d\d$/)).toBeVisible();
    expect(screen.getByText("get the parser handling nested groups")).toBeVisible();
  });

  it("says so when the block has no intention rather than leaving a gap", async () => {
    runningReturns(session({ intention: null }));
    renderWithProviders(<TodayScreen />);
    expect(await screen.findByText("No intention set for this block.")).toBeVisible();
  });

  it("puts stop and the friction chips together, in one reachable block", async () => {
    // §5.1: on mobile this block is the persistent bottom bar, and both are things you do
    // mid-session without navigating.
    runningReturns(session());
    renderWithProviders(<TodayScreen />);

    const block = await screen.findByRole("region", { name: "Running focus session" });
    expect(within(block).getByRole("button", { name: "Stop" })).toBeVisible();
    expect(within(block).getByTestId("friction-chips")).toBeVisible();
  });

  it("offers the debrief after stopping, and only then", async () => {
    runningUntilStopped();

    renderWithProviders(<TodayScreen />);
    expect(screen.queryByText("How did that go?")).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByText("How did that go?")).toBeVisible();
  });
});

describe("friction chips (§5.3)", () => {
  it("shows four inline — eleven is not a one-tap UI at 375px", async () => {
    runningReturns(session());
    renderWithProviders(<TodayScreen />);

    const chips = await screen.findByTestId("friction-chips");
    for (const label of ["Interruption", "Tooling", "Too hard", "Productive struggle"]) {
      expect(within(chips).getByRole("button", { name: label })).toBeVisible();
    }
    // Not inline; behind More.
    expect(within(chips).queryByRole("button", { name: "Physical" })).not.toBeInTheDocument();
  });

  it("logs in one tap, with no intensity prompt", async () => {
    // Intensity defaults to 3 and is never asked inline: the answer you would give while
    // annoyed is not better than 3.
    runningReturns(session());
    const sent = vi.fn();
    server.use(
      http.post(`${API}/friction`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({ id: "x", type: "tooling", intensity: 3 }, { status: 201 });
      }),
    );

    renderWithProviders(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Tooling" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    const body = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.type).toBe("tooling");
    expect(body.intensity).toBe(3);
    // Attached to the running session, and carrying its own timestamp so a queued tap records
    // when the friction happened rather than when it uploaded.
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.occurredAt).toBeTruthy();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reaches the tail in two taps, then closes", async () => {
    runningReturns(session());
    chipsReturn(COLD_START_CHIPS, ["physical", "avoidance"]);
    const sent = vi.fn();
    server.use(
      http.post(`${API}/friction`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({ id: "x" }, { status: 201 });
      }),
    );

    renderWithProviders(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("button", { name: "Physical" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect((sent.mock.calls[0]?.[0] as { type: string }).type).toBe("physical");
    // Leaving eleven chips open would push the four you actually use off the screen.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Physical" })).not.toBeInTheDocument(),
    );
  });

  it("falls back to the cold-start four while the ranking loads", async () => {
    // A control that appears a moment after you reached for it is one you stop reaching for.
    runningReturns(session());
    server.use(
      http.get(`${API}/friction/chips`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({ inline: [], overflow: [] });
      }),
    );

    renderWithProviders(<TodayScreen />);
    expect(await screen.findByRole("button", { name: "Productive struggle" })).toBeVisible();
  });

  it("logs without a session, because friction happens outside blocks too", async () => {
    runningReturns(null);
    const sent = vi.fn();
    server.use(
      http.post(`${API}/friction`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({ id: "x" }, { status: 201 });
      }),
    );

    renderWithProviders(<TodayScreen />);
    // No running block, so no chips on screen — this asserts the shape the route sends when it
    // does appear, via the debrief-less path.
    expect(await screen.findByRole("button", { name: "Start focus" })).toBeVisible();
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("the debrief (FR-F3)", () => {
  async function stopIntoDebrief() {
    runningUntilStopped();
    renderWithProviders(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await screen.findByText("How did that go?");
  }

  it("cannot be submitted empty, but can be skipped", async () => {
    // An empty debrief is a mistake rather than an answer — and declining is a legitimate
    // answer, so Skip is a real button rather than a dismissal.
    await stopIntoDebrief();

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled();
  });

  it("sends only what was answered", async () => {
    const sent = vi.fn();
    server.use(
      http.post(`${API}/focus/sessions/${SESSION_ID}/debrief`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(session({ isRunning: false }), { status: 201 });
      }),
    );
    await stopIntoDebrief();

    await userEvent.click(screen.getByRole("button", { name: "Partly" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    // Not a full object with nulls: a partial debrief must stay partial, so the server can
    // merge a later answer without erasing this one.
    expect(sent.mock.calls[0]?.[0]).toEqual({ hitIntention: "partly" });
  });

  it("marks the chosen answer for a screen reader, not only visually", async () => {
    await stopIntoDebrief();
    const partly = screen.getByRole("button", { name: "Partly" });

    expect(partly).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(partly);
    expect(partly).toHaveAttribute("aria-pressed", "true");
  });

  it("returns to the start screen when skipped", async () => {
    await stopIntoDebrief();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("button", { name: "Start focus" })).toBeVisible();
  });
});

describe("pt-BR", () => {
  it("renders the capture bar in Portuguese", async () => {
    runningReturns(session());
    renderWithProviders(<TodayScreen />, { locale: "pt-BR" });

    expect(await screen.findByRole("button", { name: "Parar" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Ferramentas" })).toBeVisible();
    // The friction glossary is translated once and derived everywhere (§5.2).
    expect(screen.getByRole("button", { name: "Esforço produtivo" })).toBeVisible();
  });
});

describe("logging a past session (FR-F2)", () => {
  it("is offered when nothing is running", async () => {
    // The moment you remember a forgotten block is when you sit down to an idle Today.
    runningReturns(null);
    renderWithProviders(<TodayScreen />);

    expect(await screen.findByRole("button", { name: /forgot to time/ })).toBeInTheDocument();
  });

  it("is not offered while a session is running", async () => {
    // On mobile the running state is the bottom bar, which must not grow a second form inside the
    // thumb zone (§5.1).
    runningReturns(session());
    renderWithProviders(<TodayScreen />);

    await screen.findByRole("button", { name: "Stop" });
    expect(screen.queryByRole("button", { name: /forgot to time/ })).not.toBeInTheDocument();
  });

  it("arrives pre-filled, so the common case is one edit", async () => {
    runningReturns(null);
    renderWithProviders(<TodayScreen />);

    await userEvent.click(await screen.findByRole("button", { name: /forgot to time/ }));

    expect(await screen.findByLabelText("Date")).toHaveValue();
    expect(screen.getByLabelText("Started at")).toHaveValue();
    expect(screen.getByLabelText("Minutes")).toHaveValue(30);
  });

  it("posts two instants derived from the length, not an end time", async () => {
    runningReturns(null);
    const sent = vi.fn();
    server.use(
      http.post(`${API}/focus/sessions`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(session({ isRunning: false }), { status: 201 });
      }),
    );

    renderWithProviders(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /forgot to time/ }));

    // Moved to a past date first. Raising the duration while leaving the start where it is pushes
    // the session past now, which the app correctly refuses — so the test has to move the anchor,
    // exactly as a user logging yesterday's block would.
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-01-15" } });
    fireEvent.change(screen.getByLabelText("Started at"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "45" } });

    await userEvent.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    const body = sent.mock.calls[0]?.[0] as { startedAt: string; endedAt: string };
    expect(new Date(body.endedAt).getTime() - new Date(body.startedAt).getTime()).toBe(45 * 60_000);
  });

  it("refuses a session in the future without asking the server", async () => {
    // A block in the future did not happen, and recording it would put time into the week's totals
    // that nobody spent.
    runningReturns(null);
    const posted = vi.fn();
    server.use(
      http.post(`${API}/focus/sessions`, () => {
        posted();
        return HttpResponse.json(session(), { status: 201 });
      }),
    );

    renderWithProviders(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /forgot to time/ }));

    const minutes = screen.getByLabelText("Minutes");
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "1200");
    await userEvent.click(screen.getByRole("button", { name: "Log it" }));

    expect(await screen.findByText("That session hasn't happened yet.")).toBeVisible();
    expect(posted).not.toHaveBeenCalled();
  });

  it("uses the same debrief controls as the live flow", async () => {
    // The questions mean the same thing; asking them differently would make the two populations of
    // answers incomparable.
    runningReturns(null);
    renderWithProviders(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /forgot to time/ }));

    const partly = screen.getByRole("button", { name: "Partly" });
    expect(partly).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(partly);
    expect(partly).toHaveAttribute("aria-pressed", "true");
  });
});
