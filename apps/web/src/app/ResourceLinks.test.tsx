import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../test/msw.js";
import { renderWithProviders } from "../test/render.js";
import { ResourcesScreen } from "./ResourcesScreen.js";

vi.mock("../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

/**
 * FR-R3 from the screen: "an article you never connect to a goal is entertainment".
 *
 * Rendered through `ResourcesScreen` rather than the route, because the pickers need mission and skill
 * names and §2.2 rule 6 keeps this feature from importing those — a test of the route alone would prove
 * nothing about whether a link can actually be made.
 */

const RESOURCE_ID = "11111111-1111-4111-8111-111111111111";
const MISSION_ID = "22222222-2222-4222-8222-222222222222";
const SKILL_ID = "33333333-3333-4333-8333-333333333333";

function seed(overrides: { missionIds?: string[]; skillIds?: string[] } = {}) {
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
            missionIds: overrides.missionIds ?? [],
            skillIds: overrides.skillIds ?? [],
            addedAt: "2026-08-06T12:00:00.000Z",
            finishedAt: null,
          },
        ],
      }),
    ),
    http.get(`${API}/missions`, () =>
      HttpResponse.json({
        missions: [{ id: MISSION_ID, topic: "Rust ownership", why: null, status: "active" }],
      }),
    ),
    http.get(`${API}/skills`, () =>
      HttpResponse.json({
        skills: [
          {
            id: SKILL_ID,
            name: "Borrowing",
            slug: "borrowing",
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
  );
}

function recordLinks() {
  const sent = vi.fn();
  server.use(
    http.put(`${API}/resources/:id/links`, async ({ request }) => {
      sent(await request.json());
      return HttpResponse.json({ id: RESOURCE_ID, missionIds: [], skillIds: [] });
    }),
  );
  return sent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("linking a resource", () => {
  it("says when nothing is connected, because that is FR-R3's warning", async () => {
    seed();
    renderWithProviders(<ResourcesScreen />);
    expect(await screen.findByText(/is just reading/)).toBeVisible();
  });

  it("links a mission, by name rather than by uuid", async () => {
    seed();
    const sent = recordLinks();
    renderWithProviders(<ResourcesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Link a mission" }));
    expect(await screen.findByRole("option", { name: "Rust ownership" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith({ missionIds: [MISSION_ID], skillIds: [] }),
    );
  });

  it("links a skill", async () => {
    seed();
    const sent = recordLinks();
    renderWithProviders(<ResourcesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Link a skill" }));
    await userEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith({ missionIds: [], skillIds: [SKILL_ID] }),
    );
  });

  it("sends the whole set, because the endpoint replaces rather than merges", async () => {
    // Adding a skill has to carry the existing mission, or the PUT would silently unlink it.
    seed({ missionIds: [MISSION_ID] });
    const sent = recordLinks();
    renderWithProviders(<ResourcesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Link a skill" }));
    await userEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith({ missionIds: [MISSION_ID], skillIds: [SKILL_ID] }),
    );
  });

  it("shows a linked mission by name", async () => {
    seed({ missionIds: [MISSION_ID] });
    renderWithProviders(<ResourcesScreen />);

    const card = await screen.findByRole("article");
    expect(within(card).getByText("Rust ownership")).toBeVisible();
    expect(screen.queryByText(/is just reading/)).not.toBeInTheDocument();
  });

  it("unlinks, keeping the other kind", async () => {
    seed({ missionIds: [MISSION_ID], skillIds: [SKILL_ID] });
    const sent = recordLinks();
    renderWithProviders(<ResourcesScreen />);

    // The first Unlink is the mission's; the skill must survive it.
    await userEvent.click((await screen.findAllByRole("button", { name: "Unlink" }))[0]!);

    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith({ missionIds: [], skillIds: [SKILL_ID] }),
    );
  });

  it("offers nothing to link when everything already is", async () => {
    // Disabled rather than hidden, so the absence is visible instead of the control silently missing.
    seed({ missionIds: [MISSION_ID], skillIds: [SKILL_ID] });
    renderWithProviders(<ResourcesScreen />);

    expect(await screen.findByRole("button", { name: "Link a mission" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Link a skill" })).toBeDisabled();
  });

  it("surfaces a refused link rather than swallowing it", async () => {
    // Not a capture path: connecting an article to a mission is a considered act, so a failure is
    // shown rather than queued.
    seed();
    server.use(
      http.put(`${API}/resources/:id/links`, () =>
        problemResponse(422, "link-target-missing", "That mission no longer exists."),
      ),
    );
    renderWithProviders(<ResourcesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Link a mission" }));
    await userEvent.click(screen.getByRole("button", { name: "Link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That mission no longer exists.");
  });

  it("falls back to the id when a name is unknown", async () => {
    // A link to something the list has not returned — deleted in another tab, or filtered out. Better a
    // raw id than a blank chip.
    seed({ missionIds: ["99999999-9999-4999-8999-999999999999"] });
    renderWithProviders(<ResourcesScreen />);

    expect(await screen.findByText("99999999-9999-4999-8999-999999999999")).toBeVisible();
  });
});
