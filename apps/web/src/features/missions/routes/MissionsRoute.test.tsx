import { MISSION_WIP_LIMIT } from "@mindforge/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import type { Mission } from "../api/use-missions.js";
import { MissionsRoute } from "./MissionsRoute.js";

// The http client asks Supabase for a token on every request. Stubbed rather than run,
// because these tests are about the missions screen, not about the auth SDK.
vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: crypto.randomUUID(),
    topic: "Rust ownership",
    why: "I keep fighting the borrow checker",
    successLooksLike: null,
    constraints: null,
    currentLevel: null,
    status: "active",
    createdAt: "2026-08-05T12:00:00.000Z",
    updatedAt: "2026-08-05T12:00:00.000Z",
    ...overrides,
  };
}

function listReturns(missions: Mission[]) {
  server.use(http.get(`${API}/missions`, () => HttpResponse.json({ missions })));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("empty state", () => {
  it("names one action instead of showing an illustration and a shrug", async () => {
    // §5.3: the empty state on every screen names one action and links to it.
    listReturns([]);
    renderWithProviders(<MissionsRoute />);

    expect(
      await screen.findByRole("button", { name: "Start your first mission" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/A mission is one thing you're trying to get better at/)).toBeVisible();
  });
});

describe("the WIP count", () => {
  it("is shown even when the limit is not reached", async () => {
    // The limit is a product rule you are meant to be aware of; discovering it as a 409
    // is the worse way to learn it.
    listReturns([mission()]);
    renderWithProviders(<MissionsRoute />);

    expect(await screen.findByText(`1 of ${MISSION_WIP_LIMIT} active`)).toBeVisible();
  });

  it("disables creating and says why once the limit is reached", async () => {
    listReturns(
      Array.from({ length: MISSION_WIP_LIMIT }, (_, i) => mission({ topic: `Mission ${i}` })),
    );
    renderWithProviders(<MissionsRoute />);

    const create = await screen.findByRole("button", { name: "New mission" });
    expect(create).toBeDisabled();
    // A disabled button with no explanation is a dead end.
    expect(screen.getByText(/Park one to start another/)).toBeVisible();
  });

  it("does not count parked missions towards the limit", async () => {
    // Parking is the pressure valve that makes the limit livable.
    listReturns([
      ...Array.from({ length: MISSION_WIP_LIMIT - 1 }, () => mission()),
      mission({ status: "parked" }),
    ]);
    renderWithProviders(<MissionsRoute />);

    expect(await screen.findByText(`2 of ${MISSION_WIP_LIMIT} active`)).toBeVisible();
    expect(screen.getByRole("button", { name: "New mission" })).toBeEnabled();
  });
});

describe("creating a mission", () => {
  it("sends the schema's output, with empty prose normalised to null", async () => {
    // The client validates with the same schema the server does, so "" must already be
    // null by the time it leaves — otherwise the two disagree about what absent means.
    listReturns([]);
    const sent = vi.fn();
    server.use(
      http.post(`${API}/missions`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(mission({ topic: "Rust lifetimes" }), { status: 201 });
      }),
    );

    renderWithProviders(<MissionsRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "Start your first mission" }));

    await userEvent.type(
      screen.getByLabelText("What do you want to get better at?"),
      "Rust lifetimes",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create mission" }));

    await waitFor(() => {
      expect(sent).toHaveBeenCalledWith({
        topic: "Rust lifetimes",
        why: null,
        successLooksLike: null,
        constraints: null,
        currentLevel: null,
      });
    });
  });

  it("refuses a too-short topic without asking the server", async () => {
    // Sharing the schema means the client can answer immediately. If this ever hits the
    // network, the two definitions have drifted.
    listReturns([]);
    const posted = vi.fn();
    server.use(
      http.post(`${API}/missions`, () => {
        posted();
        return HttpResponse.json(mission(), { status: 201 });
      }),
    );

    renderWithProviders(<MissionsRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "Start your first mission" }));
    await userEvent.type(screen.getByLabelText("What do you want to get better at?"), "no");
    await userEvent.click(screen.getByRole("button", { name: "Create mission" }));

    expect(await screen.findByText("At least 3 characters.")).toBeVisible();
    expect(posted).not.toHaveBeenCalled();
  });

  it("renders the server's translated detail on a WIP-limit refusal", async () => {
    // The whole point of the server resolving `detail` from the stored profile: the
    // client renders it without knowing what went wrong.
    listReturns([mission()]);
    server.use(
      http.post(`${API}/missions`, () =>
        problemResponse(
          409,
          "wip-limit-reached",
          "You have 3 active missions. Park one before starting another.",
        ),
      ),
    );

    renderWithProviders(<MissionsRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "New mission" }));
    await userEvent.type(screen.getByLabelText("What do you want to get better at?"), "One more");
    await userEvent.click(screen.getByRole("button", { name: "Create mission" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "You have 3 active missions. Park one before starting another.",
    );
    // wip-limit-reached is the one 409 that gets a recovery hint, which is why the slug
    // is a stable machine key rather than something to translate.
    expect(alert).toHaveTextContent("Park a mission to free a slot.");
  });

  it("translates a server field error from its code, never from its English message", async () => {
    listReturns([]);
    server.use(
      http.post(`${API}/missions`, () =>
        problemResponse(422, "validation-failed", "Some fields need fixing.", [
          { field: "topic", code: "too_small", message: "Too small: expected string to have >=3" },
        ]),
      ),
    );

    renderWithProviders(<MissionsRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "Start your first mission" }));
    await userEvent.type(
      screen.getByLabelText("What do you want to get better at?"),
      "Long enough to pass the client",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create mission" }));

    // Translated from the `code`, next to the field it belongs to.
    expect(await screen.findByText("At least 3 characters.")).toBeVisible();
    // And the server's English developer text never reaches the page. Two alerts are
    // correct here — the callout and the field — so this asserts on content, not role.
    expect(screen.queryByText(/expected string to have/)).not.toBeInTheDocument();
  });
});

describe("parking", () => {
  it("posts to park for an active mission and to unpark for a parked one", async () => {
    const active = mission({ topic: "Active one" });
    const parked = mission({ topic: "Parked one", status: "parked" });
    listReturns([active, parked]);

    const calls: string[] = [];
    server.use(
      http.post(`${API}/missions/:id/:action`, ({ params }) => {
        calls.push(String(params["action"]));
        return HttpResponse.json(active, { status: 201 });
      }),
    );

    renderWithProviders(<MissionsRoute />);

    const activeCard = (await screen.findByText("Active one")).closest("article");
    const parkedCard = screen.getByText("Parked one").closest("article");

    await userEvent.click(within(activeCard as HTMLElement).getByRole("button", { name: "Park" }));
    await waitFor(() => expect(calls).toEqual(["park"]));

    await userEvent.click(
      within(parkedCard as HTMLElement).getByRole("button", { name: "Resume" }),
    );
    await waitFor(() => expect(calls).toEqual(["park", "unpark"]));
  });

  it("shows a parked mission dimmer rather than hiding it", async () => {
    // FR-M4b: parked is not archived, and parked knowledge is still knowledge.
    listReturns([mission({ topic: "Set aside", status: "parked" })]);
    renderWithProviders(<MissionsRoute />);

    const card = (await screen.findByText("Set aside")).closest("article");
    expect(card).toHaveClass("mf-card--parked");
    expect(screen.getByText("Parked")).toBeVisible();
  });
});

describe("failures the API cannot describe", () => {
  it("uses its own copy when the request never arrives", async () => {
    // A network failure has no problem body and therefore no translated detail, so the
    // sentence has to come from the bundle.
    server.use(http.get(`${API}/missions`, () => HttpResponse.error()));
    renderWithProviders(<MissionsRoute />);

    expect(await screen.findByText(/didn't reach the server/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

describe("pt-BR", () => {
  it("renders the interface and ICU plurals in Portuguese", async () => {
    // Portuguese plural rules are not English's, and the count is interpolated by ICU on
    // both sides of the stack. Asserted in the locale where getting it wrong shows.
    listReturns(
      Array.from({ length: MISSION_WIP_LIMIT }, (_, i) => mission({ topic: `Missão ${i}` })),
    );
    renderWithProviders(<MissionsRoute />, { locale: "pt-BR" });

    expect(await screen.findByText("Missões")).toBeVisible();
    expect(screen.getByText(`3 de ${MISSION_WIP_LIMIT} ativas`)).toBeVisible();
    expect(screen.getByText(/Pause uma para começar outra/)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Pausar" })).toHaveLength(MISSION_WIP_LIMIT);
  });
});
