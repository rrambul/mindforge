import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import type { Nudge } from "../api/use-notifications.js";
import { NudgeMarker } from "./NudgeMarker.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

function nudge(overrides: Partial<Nudge> = {}): Nudge {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "stall",
    payload: { missionTopic: "Rust ownership", days: 14 },
    subjectType: "mission",
    subjectId: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-08-07T12:00:00.000Z",
    dismissedAt: null,
    ...overrides,
  };
}

function nudgesReturning(notifications: readonly Nudge[]) {
  server.use(http.get(`${API}/notifications`, () => HttpResponse.json({ notifications })));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the marker (FR-N1)", () => {
  it("renders nothing at all when there is nothing to say", async () => {
    // Not a zero badge and not a greyed bell. The quietest honest delivery of no news is no element.
    nudgesReturning([]);
    const { container } = renderWithProviders(<NudgeMarker />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("counts what is waiting", async () => {
    nudgesReturning([nudge(), nudge({ id: "22222222-2222-4222-8222-222222222222" })]);
    renderWithProviders(<NudgeMarker />);

    expect(await screen.findByRole("button", { name: "2 nudges" })).toBeVisible();
  });

  it("opens a panel rather than a modal", async () => {
    // §14.1's argument, applied to the thing it was about: no backdrop, no focus trap, and the page
    // behind stays interactive. `dialog` would be the takeover this is deliberately not.
    nudgesReturning([nudge()]);
    renderWithProviders(<NudgeMarker />);

    const marker = await screen.findByRole("button", { name: "1 nudge" });
    expect(marker).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(marker);
    expect(marker).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Nudges" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    nudgesReturning([nudge()]);
    renderWithProviders(<NudgeMarker />);

    await userEvent.click(await screen.findByRole("button", { name: "1 nudge" }));
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("region", { name: "Nudges" })).not.toBeInTheDocument();
  });
});

describe("the lines (FR-N3)", () => {
  it("translates the kind with the payload as ICU arguments", async () => {
    // The row carries arguments, never text — which is what lets the same nudge read in pt-BR.
    nudgesReturning([nudge()]);
    renderWithProviders(<NudgeMarker />);

    await userEvent.click(await screen.findByRole("button", { name: "1 nudge" }));
    expect(
      screen.getByText("No focus session on Rust ownership in 14 days. Still active, or park it?"),
    ).toBeVisible();
  });

  it("reads the same row in Portuguese", async () => {
    nudgesReturning([nudge()]);
    renderWithProviders(<NudgeMarker />, { locale: "pt-BR" });

    await userEvent.click(await screen.findByRole("button", { name: "1 aviso" }));
    expect(screen.getByText(/Nenhuma sessão de foco em Rust ownership há 14 dias/)).toBeVisible();
  });

  it("degrades rather than throwing when the payload is missing an argument", async () => {
    // These rows are written by a nightly job that does not exist yet (M3). ICU throws on a missing
    // argument, and one bad row must not blank the list.
    nudgesReturning([nudge({ payload: {} })]);
    renderWithProviders(<NudgeMarker />);

    await userEvent.click(await screen.findByRole("button", { name: "1 nudge" }));
    expect(screen.getByText("A mission has gone quiet. Still active, or park it?")).toBeVisible();
  });

  it("offers no link when the app layer has no page for the subject", async () => {
    // Better than a link that lands on a list. `hrefFor` is how the app layer supplies one.
    nudgesReturning([nudge()]);
    renderWithProviders(<NudgeMarker />);

    await userEvent.click(await screen.findByRole("button", { name: "1 nudge" }));
    expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
  });

  it("links to the subject when it does", async () => {
    nudgesReturning([nudge()]);
    renderWithProviders(<NudgeMarker hrefFor={(type, id) => `/${type}s/${id}`} />);

    await userEvent.click(await screen.findByRole("button", { name: "1 nudge" }));
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/missions/33333333-3333-4333-8333-333333333333",
    );
  });
});

describe("dismissing (FR-N5)", () => {
  it("takes the row out on the tap rather than after the round trip", async () => {
    const dismissed = vi.fn();
    // Stateful, because `onSettled` invalidates: a GET pinned to the original row would put the
    // nudge back after the refetch, and the assertion below would then be deciding which promise
    // resolved first rather than whether the removal was optimistic.
    let rows: readonly Nudge[] = [nudge()];
    server.use(
      http.get(`${API}/notifications`, () => HttpResponse.json({ notifications: rows })),
      http.post(`${API}/notifications/:id/dismiss`, async ({ params }) => {
        dismissed(params["id"]);
        rows = [];
        // Held open so the assertion after the tap cannot be satisfied by a response that already
        // landed — without the delay this test passes on a non-optimistic mutation too.
        await new Promise((resolve) => setTimeout(resolve, 300));
        return HttpResponse.json(nudge({ dismissedAt: "2026-08-07T12:01:00.000Z" }));
      }),
    );

    renderWithProviders(<NudgeMarker />);
    await userEvent.click(await screen.findByRole("button", { name: "1 nudge" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    // The marker goes with the last row, and it goes now, while the POST is still in flight: a
    // dismissed nudge is gone, not archived somewhere you can browse and feel bad about.
    await waitFor(
      () => {
        expect(screen.queryByRole("button", { name: /nudge/ })).not.toBeInTheDocument();
      },
      { timeout: 200 },
    );

    await waitFor(() =>
      expect(dismissed).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111"),
    );
  });
});

describe("signed out", () => {
  it("asks for nothing", () => {
    // MSW is configured to fail on an unhandled request, so no handler here is the assertion.
    const { container } = renderWithProviders(<NudgeMarker enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
