import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { NotesRoute } from "./NotesRoute.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    body: "the borrow checker finally clicked",
    subjectType: "standalone",
    subjectId: null,
    quote: null,
    locator: null,
    isHighlight: false,
    pinned: false,
    lang: "english",
    createdAt: "2026-08-05T12:00:00.000Z",
    updatedAt: "2026-08-05T12:00:00.000Z",
    ...overrides,
  };
}

/** Records every search the screen issued, so a test can assert what reached the server. */
function notesReturning(byQuery: Record<string, object[]>, seen: string[] = []) {
  server.use(
    http.get(`${API}/notes`, ({ request }) => {
      const q = new URL(request.url).searchParams.get("q") ?? "";
      seen.push(q);
      return HttpResponse.json({ notes: byQuery[q] ?? byQuery[""] ?? [] });
    }),
  );
  return seen;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("writing", () => {
  it("takes a note with no subject picker", async () => {
    // §6.14: no picker, no filing. An unfiled note is a first-class outcome, not a fallback.
    notesReturning({ "": [] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/notes`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(note(), { status: 201 });
      }),
    );

    renderWithProviders(<NotesRoute />);
    await userEvent.type(await screen.findByLabelText("Note"), "a thought");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    const body = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.body).toBe("a thought");
    expect(body.subjectType).toBe("standalone");
    // Client-minted, so a replay is the same note rather than a second one (§6.1).
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("clears the box immediately rather than waiting for the server", async () => {
    // The write is optimistic and queued if it cannot reach the server, so holding the text hostage
    // to a round trip is the one thing the capture budget forbids.
    notesReturning({ "": [] });
    server.use(
      http.post(`${API}/notes`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return HttpResponse.json(note(), { status: 201 });
      }),
    );

    renderWithProviders(<NotesRoute />);
    const box = await screen.findByLabelText("Note");
    await userEvent.type(box, "a thought");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    expect(box).toHaveValue("");
  });

  it("will not save an empty or whitespace-only note", async () => {
    notesReturning({ "": [] });
    const posted = vi.fn();
    server.use(
      http.post(`${API}/notes`, () => {
        posted();
        return HttpResponse.json(note(), { status: 201 });
      }),
    );

    renderWithProviders(<NotesRoute />);
    expect(await screen.findByRole("button", { name: "Save note" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Note"), "   ");
    expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
    expect(posted).not.toHaveBeenCalled();
  });
});

describe("search (FR-N6)", () => {
  it("sends the query to the server rather than filtering locally", async () => {
    // The stemming is a Postgres feature — "clicked" matching "click" cannot be reproduced in the
    // client, so filtering here would silently give worse results than the API can.
    const seen = notesReturning({ "": [note()], click: [note()] });

    renderWithProviders(<NotesRoute />);
    await screen.findByText("the borrow checker finally clicked");

    await userEvent.type(screen.getByLabelText("Search notes"), "click");
    await waitFor(() => expect(seen).toContain("click"));
  });

  it("treats a blank query as no filter, not as a search for nothing", async () => {
    const seen = notesReturning({ "": [note()] });

    renderWithProviders(<NotesRoute />);
    await screen.findByText("the borrow checker finally clicked");

    await userEvent.type(screen.getByLabelText("Search notes"), "   ");
    await waitFor(() => expect(seen.every((q) => q === "")).toBe(true));
  });

  it("distinguishes nothing written from nothing matching", async () => {
    // Two different facts. "Nothing yet" is an invitation; "no match" is about the query.
    const seen: string[] = [];
    notesReturning({ "": [note()], kubernetes: [] }, seen);

    renderWithProviders(<NotesRoute />);
    await screen.findByText("the borrow checker finally clicked");

    await userEvent.type(screen.getByLabelText("Search notes"), "kubernetes");
    expect(await screen.findByText("No notes match that.")).toBeVisible();
  });

  it("invites a first note when there are none at all", async () => {
    notesReturning({ "": [] });
    renderWithProviders(<NotesRoute />);
    expect(await screen.findByText(/A note is a thought you had while working/)).toBeVisible();
  });
});

describe("a highlight", () => {
  it("shows the quote above the note", async () => {
    // The quote is what you were responding to; reading the response first is backwards.
    notesReturning({
      "": [
        note({
          body: "worth remembering",
          quote: "lifetimes describe relationships",
          isHighlight: true,
          subjectType: "resource",
          subjectId: crypto.randomUUID(),
        }),
      ],
    });

    renderWithProviders(<NotesRoute />);
    const card = (await screen.findByText("worth remembering")).closest("article");
    expect(within(card as HTMLElement).getByText("lifetimes describe relationships")).toBeVisible();
    // The subject is translated from a key, not stored as display text (§5.2).
    expect(within(card as HTMLElement).getByText("Resource")).toBeVisible();
  });
});

describe("pinning", () => {
  it("patches only the pinned flag", async () => {
    notesReturning({ "": [note({ pinned: false })] });
    const sent = vi.fn();
    server.use(
      http.patch(`${API}/notes/:id`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(note({ pinned: true }), { status: 200 });
      }),
    );

    renderWithProviders(<NotesRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "Pin" }));

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ pinned: true }));
  });

  it("surfaces a failed pin rather than queueing it", async () => {
    // Pinning is a considered action on something already saved, not a capture — so a failure has to
    // be visible instead of disappearing into the offline queue.
    notesReturning({ "": [note()] });
    server.use(
      http.patch(`${API}/notes/:id`, () =>
        problemResponse(404, "note-not-found", "That note no longer exists."),
      ),
    );

    renderWithProviders(<NotesRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "Pin" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That note no longer exists.");
  });
});

describe("deleting", () => {
  it("deletes and refreshes", async () => {
    const seen = notesReturning({ "": [note()] });
    const deleted = vi.fn();
    server.use(
      http.delete(`${API}/notes/:id`, ({ params }) => {
        deleted(params["id"]);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<NotesRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleted).toHaveBeenCalled());
    // Refetched, because a deleted note must not linger in a list the user is looking at.
    await waitFor(() => expect(seen.length).toBeGreaterThan(1));
  });
});

describe("pt-BR", () => {
  it("renders the screen and the subject vocabulary in Portuguese", async () => {
    notesReturning({
      "": [note({ subjectType: "focus_session", subjectId: crypto.randomUUID() })],
    });

    renderWithProviders(<NotesRoute />, { locale: "pt-BR" });

    // Awaited on the note, not on the heading: the heading renders before the query resolves, so
    // asserting on it would pass while the list still said "Carregando".
    expect(await screen.findByText("the borrow checker finally clicked")).toBeVisible();
    expect(screen.getByText("Notas")).toBeVisible();
    expect(screen.getByLabelText("Buscar notas")).toBeVisible();
    // Translated once in the glossary and derived everywhere (§5.2).
    expect(screen.getByText("Sessão de foco")).toBeVisible();
  });
});
