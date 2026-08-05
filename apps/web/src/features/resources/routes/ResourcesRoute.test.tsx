import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { ResourcesRoute } from "./ResourcesRoute.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

function resource(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    type: "book",
    title: "Programming Rust",
    author: "Jim Blandy",
    url: null,
    status: "active",
    abandonReason: null,
    progress: { unit: "page", current: 0, total: null },
    fraction: null,
    isMeasurable: true,
    addedAt: "2026-08-05T12:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

/** Records the status filter each request carried, so a test can assert what reached the server. */
function resourcesReturning(byStatus: Record<string, object[]>, seen: string[] = []) {
  server.use(
    http.get(`${API}/resources`, ({ request }) => {
      const status = new URL(request.url).searchParams.get("status") ?? "";
      seen.push(status);
      return HttpResponse.json({ resources: byStatus[status] ?? byStatus[""] ?? [] });
    }),
  );
  return seen;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("capture (FR-R2)", () => {
  it("sends a pasted URL and nothing else", async () => {
    // The whole feature: no type picker, no title field. Asking would cost a tap every time to save
    // one on the few the server guesses wrong.
    resourcesReturning({ "": [] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/resources/capture`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(resource(), { status: 201 });
      }),
    );

    renderWithProviders(<ResourcesRoute />);
    await userEvent.type(await screen.findByLabelText("Paste a link"), "https://example.test/a");
    await userEvent.click(screen.getByRole("button", { name: "Capture" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    const body = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.url).toBe("https://example.test/a");
    // Client-minted, so a replay from the queue is the same resource rather than a second copy.
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.title).toBeUndefined();
    expect(body.type).toBeUndefined();
  });

  it("captures on Enter, which is what a paste lands you in", async () => {
    resourcesReturning({ "": [] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/resources/capture`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(resource(), { status: 201 });
      }),
    );

    renderWithProviders(<ResourcesRoute />);
    await userEvent.type(
      await screen.findByLabelText("Paste a link"),
      "https://example.test/a{Enter}",
    );

    await waitFor(() => expect(sent).toHaveBeenCalled());
  });

  it("clears the box immediately rather than waiting for the server", async () => {
    // The capture is queued if it cannot reach the server, so holding the text hostage to a round
    // trip is the one thing the budget forbids.
    resourcesReturning({ "": [] });
    server.use(
      http.post(`${API}/resources/capture`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return HttpResponse.json(resource(), { status: 201 });
      }),
    );

    renderWithProviders(<ResourcesRoute />);
    const box = await screen.findByLabelText("Paste a link");
    await userEvent.type(box, "https://example.test/a");
    await userEvent.click(screen.getByRole("button", { name: "Capture" }));

    expect(box).toHaveValue("");
  });

  it("will not capture an empty box", async () => {
    resourcesReturning({ "": [] });
    renderWithProviders(<ResourcesRoute />);
    expect(await screen.findByRole("button", { name: "Capture" })).toBeDisabled();
  });
});

describe("progress (FR-R3)", () => {
  it("sends the position and the total the first time", async () => {
    resourcesReturning({ "": [resource()] });
    const sent = vi.fn();
    server.use(
      http.patch(`${API}/resources/:id/progress`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(
          resource({ progress: { unit: "page", current: 137, total: 590 } }),
        );
      }),
    );

    renderWithProviders(<ResourcesRoute />);
    await userEvent.type(await screen.findByLabelText("Page"), "137");
    await userEvent.type(screen.getByLabelText("of an unknown total"), "590");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ current: 137, total: 590 }));
  });

  it("stops asking for the total once it is known", async () => {
    // Re-typing 590 every time you close the book is exactly the friction that makes people stop
    // recording progress.
    resourcesReturning({
      "": [resource({ progress: { unit: "page", current: 137, total: 590 } })],
    });

    renderWithProviders(<ResourcesRoute />);
    await screen.findByLabelText("Page");
    expect(screen.queryByLabelText("of an unknown total")).not.toBeInTheDocument();
    expect(screen.getByText("of 590")).toBeVisible();
  });

  it("labels the control in the resource's own unit", async () => {
    // A page number on a podcast would be a figure with no referent.
    resourcesReturning({
      "": [resource({ type: "podcast", progress: { unit: "second", current: 0, total: null } })],
    });

    renderWithProviders(<ResourcesRoute />);
    expect(await screen.findByLabelText("Position")).toBeVisible();
  });

  it("offers no control at all for something unmeasured", async () => {
    resourcesReturning({
      "": [resource({ type: "article", isMeasurable: false, progress: null })],
    });

    renderWithProviders(<ResourcesRoute />);
    expect(await screen.findByText(/nothing to measure/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("shows a bar only when there is a real fraction", async () => {
    // `fraction` is null rather than 0 when the total is unknown, and an empty bar would claim you
    // had made no progress — a different and false statement.
    resourcesReturning({
      "": [resource({ progress: { unit: "second", current: 1420, total: null }, fraction: null })],
    });

    renderWithProviders(<ResourcesRoute />);
    await screen.findByText("Programming Rust");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the bar at the reported fraction", async () => {
    resourcesReturning({
      "": [resource({ progress: { unit: "page", current: 295, total: 590 }, fraction: 0.5 })],
    });

    renderWithProviders(<ResourcesRoute />);
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });
});

describe("finishing and abandoning (FR-R5)", () => {
  it("abandons in one tap, with no reason demanded", async () => {
    // Requiring a justification turns quitting into a confession, and the result is items that sit in
    // `active` forever — worse data than a bare abandonment.
    resourcesReturning({ "": [resource()] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/resources/:id/abandon`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(resource({ status: "abandoned" }));
      }),
    );

    renderWithProviders(<ResourcesRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "Stop reading" }));

    await waitFor(() => expect(sent).toHaveBeenCalledWith({}));
  });

  it("states an abandonment plainly, with no editorial", async () => {
    resourcesReturning({
      "": [resource({ status: "abandoned", abandonReason: "too shallow" })],
    });

    renderWithProviders(<ResourcesRoute />);
    expect(await screen.findByText("Stopped: too shallow")).toBeVisible();
  });

  it("offers no progress or finish control on something already over", async () => {
    resourcesReturning({ "": [resource({ status: "finished" })] });

    renderWithProviders(<ResourcesRoute />);
    await screen.findByText("Programming Rust");
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("surfaces a refused finish rather than swallowing it", async () => {
    // Finishing is a considered decision about something already saved, not a capture, so a failure
    // has to be visible instead of disappearing into the offline queue.
    resourcesReturning({ "": [resource()] });
    server.use(
      http.post(`${API}/resources/:id/finish`, () =>
        problemResponse(404, "resource-not-found", "That resource no longer exists."),
      ),
    );

    renderWithProviders(<ResourcesRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "Finish" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That resource no longer exists.");
  });
});

describe("triage", () => {
  it("queues an inbox capture", async () => {
    resourcesReturning({ "": [resource({ status: "inbox" })] });
    const sent = vi.fn();
    server.use(
      http.patch(`${API}/resources/:id`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(resource({ status: "queued" }));
      }),
    );

    renderWithProviders(<ResourcesRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "Queue" }));

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ status: "queued" }));
  });

  it("labels the filter from the glossary, so the vocabulary cannot drift", async () => {
    // The same words appear on the chips. Two copies of "Reading" is two things that can disagree.
    resourcesReturning({ "": [resource()] });
    renderWithProviders(<ResourcesRoute />);

    const filter = await screen.findByLabelText("Show");
    expect(within(filter).getByRole("option", { name: "Reading" })).toBeInTheDocument();
    expect(within(filter).getByRole("option", { name: "Everything" })).toBeInTheDocument();
  });

  it("filters on the server rather than in the client", async () => {
    // The list is capped and sorted server-side, so filtering here would show a filtered page of an
    // unfiltered cap — the wrong rows, silently.
    const seen = resourcesReturning({ "": [resource()], inbox: [] });

    renderWithProviders(<ResourcesRoute />);
    await screen.findByText("Programming Rust");

    await userEvent.selectOptions(screen.getByLabelText("Show"), "inbox");
    await waitFor(() => expect(seen).toContain("inbox"));
  });

  it("distinguishes an empty library from an empty filter", async () => {
    const seen: string[] = [];
    resourcesReturning({ "": [resource()], inbox: [] }, seen);

    renderWithProviders(<ResourcesRoute />);
    await screen.findByText("Programming Rust");

    await userEvent.selectOptions(screen.getByLabelText("Show"), "inbox");
    expect(await screen.findByText("Nothing in this list.")).toBeVisible();
  });

  it("invites a first capture when there is nothing at all", async () => {
    resourcesReturning({ "": [] });
    renderWithProviders(<ResourcesRoute />);
    expect(await screen.findByText(/Paste a link to anything/)).toBeVisible();
  });
});

describe("adding without a link", () => {
  it("stays behind a disclosure so it never competes with the URL box", async () => {
    resourcesReturning({ "": [] });
    renderWithProviders(<ResourcesRoute />);

    await screen.findByLabelText("Paste a link");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add something without a link" }));
    expect(screen.getByLabelText("Title")).toBeVisible();
  });

  it("sends a typed resource with its chosen type", async () => {
    resourcesReturning({ "": [] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/resources`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(resource(), { status: 201 });
      }),
    );

    renderWithProviders(<ResourcesRoute />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Add something without a link" }),
    );
    await userEvent.type(screen.getByLabelText("Title"), "Programming Rust");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "book");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    const body = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({ type: "book", title: "Programming Rust", status: "queued" });
  });

  it("will not add without a title", async () => {
    resourcesReturning({ "": [] });
    renderWithProviders(<ResourcesRoute />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Add something without a link" }),
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });
});

describe("the card", () => {
  it("names the type and status from the glossary, not from stored display text", async () => {
    resourcesReturning({ "": [resource({ type: "podcast", status: "queued" })] });

    renderWithProviders(<ResourcesRoute />);
    const card = (await screen.findByText("Programming Rust")).closest("article");
    expect(within(card as HTMLElement).getByText("Podcast")).toBeVisible();
    expect(within(card as HTMLElement).getByText("Queued")).toBeVisible();
  });

  it("opens a captured link in a new tab without leaking the referrer", async () => {
    resourcesReturning({ "": [resource({ url: "https://example.test/a" })] });

    renderWithProviders(<ResourcesRoute />);
    const link = await screen.findByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("href", "https://example.test/a");
    expect(link).toHaveAttribute("target", "_blank");
    // `noreferrer` implies `noopener`; without it the opened page gets a handle on this one.
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("has no link for something with no URL", async () => {
    resourcesReturning({ "": [resource({ url: null })] });
    renderWithProviders(<ResourcesRoute />);
    await screen.findByText("Programming Rust");
    expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
  });
});

describe("pt-BR", () => {
  it("renders the screen and the resource vocabulary in Portuguese", async () => {
    resourcesReturning({ "": [resource({ type: "book", status: "active" })] });

    renderWithProviders(<ResourcesRoute />, { locale: "pt-BR" });

    const card = (await screen.findByText("Programming Rust")).closest("article");
    expect(screen.getByText("Biblioteca")).toBeVisible();
    expect(screen.getByLabelText("Cole um link")).toBeVisible();
    // Translated once in the glossary and derived everywhere (§5.2) — scoped to the card because the
    // filter derives its options from the same glossary keys, which is the point.
    expect(within(card as HTMLElement).getByText("Livro")).toBeVisible();
    expect(within(card as HTMLElement).getByText("Lendo")).toBeVisible();
    // The select branch of the ICU message, which is what the i18n checker had to learn to parse.
    expect(screen.getByLabelText("Página")).toBeVisible();
  });
});
