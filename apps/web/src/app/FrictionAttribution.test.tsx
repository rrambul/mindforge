import { screen, waitFor } from "@testing-library/react";
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

/**
 * §5.3: friction detail belongs in the debrief, "where you have the time". The chip tap is a one-tap
 * capture and must not grow a picker.
 *
 * Driven through `TodayScreen` because that is where the debrief and the friction feature are composed —
 * §2.2 rule 6 keeps `focus` from importing `friction`, skills, or resources.
 */

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const SKILL_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID = "44444444-4444-4444-8444-444444444444";

/** Gets the screen to the debrief, which is the only place attribution appears. */
function atDebrief(events: object[]) {
  // The running query has to stop reporting a session after the stop, or the refetch that follows puts
  // the timer back and the debrief never renders — `session` wins over `awaitingDebrief` by design.
  let running = true;

  server.use(
    http.get(`${API}/focus/sessions/running`, () =>
      HttpResponse.json({
        session: running
          ? { id: SESSION_ID, startedAt: "2026-08-06T12:00:00.000Z", intention: null, minutes: 40 }
          : null,
      }),
    ),
    http.post(`${API}/focus/sessions/:id/stop`, () => {
      running = false;
      return HttpResponse.json(
        { id: SESSION_ID, minutes: 40, isRunning: false, endedAt: "2026-08-06T12:40:00.000Z" },
        { status: 201 },
      );
    }),
    http.get(`${API}/friction/chips`, () =>
      HttpResponse.json({ inline: ["tooling"], overflow: [] }),
    ),
    http.get(`${API}/friction/sessions/:sessionId`, () => HttpResponse.json({ events })),
    http.get(`${API}/skills`, () =>
      HttpResponse.json({
        skills: [
          {
            id: SKILL_ID,
            name: "Rust ownership",
            slug: "rust-ownership",
            description: null,
            perceivedLevel: null,
            score: null,
            scoreStdDev: null,
            band: null,
            perceivedBand: null,
            feather: "vague",
            halfLifeDays: 90,
            lastEvidenceAt: null,
            calibrationGap: null,
            calibrationVerdict: null,
            calibrationMissing: "both",
            bandGap: null,
            prerequisiteIds: [],
            createdAt: "2026-08-06T12:00:00.000Z",
          },
        ],
      }),
    ),
    http.get(`${API}/resources`, () =>
      HttpResponse.json({
        resources: [
          {
            id: RESOURCE_ID,
            type: "book",
            title: "Programming Rust",
            author: null,
            url: null,
            status: "active",
            abandonReason: null,
            progress: null,
            fraction: null,
            isMeasurable: false,
            missionIds: [],
            skillIds: [],
            addedAt: "2026-08-06T12:00:00.000Z",
            finishedAt: null,
          },
        ],
      }),
    ),
    http.get(`${API}/missions`, () => HttpResponse.json({ missions: [] })),
  );
}

function anEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    type: "tooling",
    intensity: 3,
    occurredAt: "2026-08-06T12:10:00.000Z",
    skillId: null,
    resourceId: null,
    ...overrides,
  };
}

function recordAttribution() {
  const sent = vi.fn();
  server.use(
    http.patch(`${API}/friction/:id`, async ({ request, params }) => {
      sent(params["id"], await request.json());
      return HttpResponse.json(anEvent());
    }),
  );
  return sent;
}

/** Stops the running session, which is what opens the debrief. */
async function openDebrief(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
  await screen.findByText("How did that go?");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("attributing friction in the debrief (§5.3)", () => {
  it("lists the session's friction with a skill and a resource picker", async () => {
    atDebrief([anEvent()]);
    renderWithProviders(<TodayScreen />);
    await openDebrief();

    expect(await screen.findByLabelText("Skill")).toBeVisible();
    expect(screen.getByLabelText("Resource")).toBeVisible();
  });

  it("attributes an event to a skill", async () => {
    atDebrief([anEvent()]);
    const sent = recordAttribution();
    renderWithProviders(<TodayScreen />);
    await openDebrief();

    await userEvent.selectOptions(await screen.findByLabelText("Skill"), SKILL_ID);
    await waitFor(() => expect(sent).toHaveBeenCalledWith(EVENT_ID, { skillId: SKILL_ID }));
  });

  it("attributes an event to a resource", async () => {
    atDebrief([anEvent()]);
    const sent = recordAttribution();
    renderWithProviders(<TodayScreen />);
    await openDebrief();

    await userEvent.selectOptions(await screen.findByLabelText("Resource"), RESOURCE_ID);
    await waitFor(() => expect(sent).toHaveBeenCalledWith(EVENT_ID, { resourceId: RESOURCE_ID }));
  });

  it("retracts an attribution by choosing 'Not sure'", async () => {
    // A wrong guess must not be permanent.
    atDebrief([anEvent({ skillId: SKILL_ID })]);
    const sent = recordAttribution();
    renderWithProviders(<TodayScreen />);
    await openDebrief();

    await userEvent.selectOptions(await screen.findByLabelText("Skill"), "");
    await waitFor(() => expect(sent).toHaveBeenCalledWith(EVENT_ID, { skillId: null }));
  });

  it("sends only the field that changed, so the other survives", async () => {
    // Absent means unchanged on the server, which is what makes two independent pickers possible.
    atDebrief([anEvent({ skillId: SKILL_ID })]);
    const sent = recordAttribution();
    renderWithProviders(<TodayScreen />);
    await openDebrief();

    await userEvent.selectOptions(await screen.findByLabelText("Resource"), RESOURCE_ID);
    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect(sent.mock.calls[0]?.[1]).toEqual({ resourceId: RESOURCE_ID });
  });

  it("shows nothing when the session had no friction", async () => {
    // An empty "what was this about?" block would be a question about something that did not happen.
    atDebrief([]);
    renderWithProviders(<TodayScreen />);
    await openDebrief();

    expect(screen.queryByLabelText("Skill")).not.toBeInTheDocument();
    expect(screen.queryByText(/What was that friction about/)).not.toBeInTheDocument();
  });

  it("does not block the debrief, because attribution is optional", async () => {
    // The ≤30s budget is about the three questions; this sits below them and Submit does not wait.
    atDebrief([anEvent()]);
    const debriefed = vi.fn();
    server.use(
      http.post(`${API}/focus/sessions/:id/debrief`, async ({ request }) => {
        debriefed(await request.json());
        return HttpResponse.json({ id: SESSION_ID, isRunning: false });
      }),
    );

    renderWithProviders(<TodayScreen />);
    await openDebrief();

    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(debriefed).toHaveBeenCalledWith({ hitIntention: "yes" }));
  });

  it("surfaces a refused attribution", async () => {
    // A considered answer, not a capture — so it is shown rather than queued.
    atDebrief([anEvent()]);
    server.use(
      http.patch(`${API}/friction/:id`, () =>
        problemResponse(422, "attribution-target-missing", "That skill no longer exists."),
      ),
    );
    renderWithProviders(<TodayScreen />);
    await openDebrief();

    await userEvent.selectOptions(await screen.findByLabelText("Skill"), SKILL_ID);
    expect(await screen.findByRole("alert")).toHaveTextContent("That skill no longer exists.");
  });

  it("names the friction type from the shared vocabulary", async () => {
    atDebrief([anEvent({ type: "productive_struggle" })]);
    renderWithProviders(<TodayScreen />);
    await openDebrief();

    // The chips are gone by now — the session has stopped — so the only "Productive struggle" on the
    // screen is the attributed event's own label.
    expect(await screen.findByText("Productive struggle")).toBeVisible();
  });
});
