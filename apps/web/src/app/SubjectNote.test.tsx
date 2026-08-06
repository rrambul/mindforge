import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../test/msw.js";
import { renderWithProviders } from "../test/render.js";
import { MissionsScreen } from "./MissionsScreen.js";
import { ResourcesScreen } from "./ResourcesScreen.js";
import { SkillsScreen } from "./SkillsScreen.js";

vi.mock("../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

/**
 * M1's "notes on anything" bullet: one tap from a running session, **or from any resource, skill, or
 * mission**. The session half shipped first; this is the other half.
 *
 * These render the *screen* rather than the route, because the screen is where the cross-feature wiring
 * lives — §2.2 rule 6 keeps a resource card from reaching into the notes feature, so a test of the
 * route alone would prove nothing about whether a note can actually be written from one.
 */

const RESOURCE_ID = "11111111-1111-4111-8111-111111111111";
const SKILL_ID = "22222222-2222-4222-8222-222222222222";
const MISSION_ID = "33333333-3333-4333-8333-333333333333";

/** Records the note body the client sent. */
function recordNotes() {
  const sent = vi.fn();
  server.use(
    http.post(`${API}/notes`, async ({ request }) => {
      sent(await request.json());
      return HttpResponse.json({ id: crypto.randomUUID() }, { status: 201 });
    }),
  );
  return sent;
}

function seedScreens() {
  server.use(
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
            progress: { unit: "page", current: 0, total: null },
            fraction: null,
            isMeasurable: true,
            addedAt: "2026-08-06T12:00:00.000Z",
            finishedAt: null,
          },
        ],
      }),
    ),
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
    http.get(`${API}/missions`, () =>
      HttpResponse.json({
        missions: [
          { id: MISSION_ID, topic: "Rust ownership", why: "so I can review PRs", status: "active" },
        ],
      }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  seedScreens();
});

describe("writing a note from a card", () => {
  it("attaches it to the resource (FR-N1)", async () => {
    const sent = recordNotes();
    renderWithProviders(<ResourcesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Add a note" }));
    await userEvent.type(screen.getByLabelText("Note"), "the borrow chapter finally clicked");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      body: "the borrow chapter finally clicked",
      subjectType: "resource",
      subjectId: RESOURCE_ID,
    });
  });

  it("attaches it to the skill", async () => {
    const sent = recordNotes();
    renderWithProviders(<SkillsScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Add a note" }));
    await userEvent.type(screen.getByLabelText("Note"), "lifetimes are relationships");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      subjectType: "skill",
      subjectId: SKILL_ID,
    });
  });

  it("attaches it to the mission", async () => {
    const sent = recordNotes();
    renderWithProviders(<MissionsScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Add a note" }));
    await userEvent.type(screen.getByLabelText("Note"), "worth splitting this in two");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      subjectType: "mission",
      subjectId: MISSION_ID,
    });
  });

  it("never asks which subject, because the card already knows (§6.14)", async () => {
    // The rule the whole design rests on. A picker here would put filing between a thought and
    // recording it, and `standalone` would stop being the escape hatch and start being the default.
    recordNotes();
    renderWithProviders(<ResourcesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Add a note" }));
    expect(screen.queryByLabelText(/subject/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /note/i })).not.toBeInTheDocument();
  });

  it("mints a client id, so a replay from the queue is the same note", async () => {
    const sent = recordNotes();
    renderWithProviders(<ResourcesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Add a note" }));
    await userEvent.type(screen.getByLabelText("Note"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect((sent.mock.calls[0]?.[0] as Record<string, unknown>).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("names no language, leaving the server to derive it (FR-L4)", async () => {
    const sent = recordNotes();
    renderWithProviders(<SkillsScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Add a note" }));
    await userEvent.type(screen.getByLabelText("Note"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect((sent.mock.calls[0]?.[0] as Record<string, unknown>).lang).toBeUndefined();
  });
});

describe("the composer on a card", () => {
  it("is collapsed until asked for", async () => {
    // A permanently-open textarea on every card in a list of twenty would be absurd, and one tap to
    // open is what §7.1 allows for a capture that involves typing.
    recordNotes();
    renderWithProviders(<ResourcesScreen />);

    expect(await screen.findByRole("button", { name: "Add a note" })).toBeVisible();
    expect(screen.queryByLabelText("Note")).not.toBeInTheDocument();
  });

  it("clears the box immediately rather than waiting for the server", async () => {
    server.use(
      http.post(`${API}/notes`, async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 300);
        });
        return HttpResponse.json({ id: crypto.randomUUID() }, { status: 201 });
      }),
    );
    renderWithProviders(<ResourcesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Add a note" }));
    const box = screen.getByLabelText("Note");
    await userEvent.type(box, "a thought");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    expect(box).not.toBeInTheDocument();
  });

  it("shows a refusal", async () => {
    server.use(
      http.post(`${API}/notes`, () =>
        problemResponse(422, "validation-failed", "That note is too long."),
      ),
    );
    renderWithProviders(<ResourcesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Add a note" }));
    await userEvent.type(screen.getByLabelText("Note"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That note is too long.");
  });

  it("says nothing when the note was only queued", async () => {
    // It has been queued and will land, so an alert beside the card would contradict the shell's
    // pending count — which is the honest report because it says "waiting" rather than "failed".
    server.use(http.post(`${API}/notes`, () => HttpResponse.error()));
    renderWithProviders(<ResourcesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Add a note" }));
    await userEvent.type(screen.getByLabelText("Note"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Add a note" })).toBeVisible());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
