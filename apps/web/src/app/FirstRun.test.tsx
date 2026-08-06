import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../test/msw.js";
import { renderWithProviders } from "../test/render.js";
import { FirstRun } from "./FirstRun.js";

vi.mock("../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const MISSION_ID = "11111111-1111-4111-8111-111111111111";
const GOAL_ID = "22222222-2222-4222-8222-222222222222";
const RESOURCE_ID = "33333333-3333-4333-8333-333333333333";

/** An account with this many missions, which is how the offer is decided. */
function missions(count: number) {
  server.use(
    http.get(`${API}/missions`, () =>
      HttpResponse.json({
        missions: Array.from({ length: count }, (_, i) => ({
          id: `m${i}`,
          topic: `Mission ${i}`,
          status: "active",
        })),
      }),
    ),
  );
}

/** Records every write the tour makes, so a test can assert what it actually created. */
function recordWrites() {
  const written: Record<string, unknown> = {};

  server.use(
    http.post(`${API}/missions`, async ({ request }) => {
      written["mission"] = await request.json();
      return HttpResponse.json(
        { id: MISSION_ID, topic: "Rust", status: "active" },
        { status: 201 },
      );
    }),
    http.post(`${API}/goals`, async ({ request }) => {
      written["goal"] = await request.json();
      return HttpResponse.json({ id: GOAL_ID, title: "x", targets: [] }, { status: 201 });
    }),
    http.post(`${API}/resources/capture`, async ({ request }) => {
      written["capture"] = await request.json();
      return HttpResponse.json({ id: RESOURCE_ID, title: "A page" }, { status: 201 });
    }),
    http.post(`${API}/resources`, async ({ request }) => {
      written["resource"] = await request.json();
      return HttpResponse.json({ id: RESOURCE_ID, title: "A book" }, { status: 201 });
    }),
    http.post(`${API}/focus/sessions/start`, async ({ request }) => {
      written["session"] = await request.json();
      return HttpResponse.json(
        { id: "s1", startedAt: "2026-08-06T12:00:00.000Z" },
        { status: 201 },
      );
    }),
  );

  return written;
}

/** Walks the four steps. */
async function completeTour(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Start" }));

  await userEvent.type(screen.getByLabelText("What are you working on?"), "Rust ownership");
  await userEvent.type(screen.getByLabelText("Why this, now?"), "so I can review Rust PRs");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  await userEvent.type(
    await screen.findByLabelText("What do you want to be true?"),
    "I can explain lifetimes",
  );
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  await userEvent.type(await screen.findByLabelText("A link"), "https://doc.rust-lang.test/ch04");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  await userEvent.type(
    await screen.findByLabelText("What does done look like for these 15 minutes?"),
    "read chapter 4",
  );
  await userEvent.click(screen.getByRole("button", { name: "Start 15 minutes" }));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

describe("the offer", () => {
  it("offers the tour to an empty account", async () => {
    missions(0);
    renderWithProviders(<FirstRun />);
    expect(await screen.findByText(/Set up your first mission/)).toBeVisible();
  });

  it("says nothing to an account that already has a mission", async () => {
    // Someone who created one by hand does not need to be shown how, and the banner would sit above the
    // one screen the product needs them to use daily.
    missions(1);
    const { container } = renderWithProviders(<FirstRun />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("does not flash the banner before the count is known", () => {
    // Showing it and then removing it is worse than showing it a moment late.
    server.use(
      // Slow on purpose: the assertion is about what renders *before* the count arrives.
      http.get(`${API}/missions`, async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 200);
        });
        return HttpResponse.json({ missions: [{ id: "m0", topic: "x", status: "active" }] });
      }),
    );

    const { container } = renderWithProviders(<FirstRun />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stops offering once dismissed, and stays dismissed across a remount", async () => {
    // "Not now" has to mean it, or the banner becomes something to be dismissed daily.
    missions(0);
    const { unmount } = renderWithProviders(<FirstRun />);

    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    unmount();

    const { container } = renderWithProviders(<FirstRun />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("the four steps (§5.3)", () => {
  it("creates a real mission, goal, resource, and session", async () => {
    // Not demo data: every step goes through the same endpoints the rest of the app uses, so what the
    // user is left with is theirs to keep.
    missions(0);
    const written = recordWrites();

    renderWithProviders(<FirstRun />);
    await completeTour();

    await waitFor(() => expect(written["session"]).toBeDefined());
    expect(written["mission"]).toMatchObject({
      topic: "Rust ownership",
      why: "so I can review Rust PRs",
    });
  });

  it("hangs the goal off the mission it just created", async () => {
    // The steps build on each other — that connection is the whole reason this is a tour rather than
    // four separate forms.
    missions(0);
    const written = recordWrites();

    renderWithProviders(<FirstRun />);
    await completeTour();

    await waitFor(() => expect(written["goal"]).toBeDefined());
    expect(written["goal"]).toMatchObject({ missionId: MISSION_ID });
  });

  it("gives the goal a focus-hours target, which measures itself from the next step", async () => {
    // A resource target would sit unmeasurable until something was read and a skill target cannot be
    // measured at all until M2 — either would teach that goals show nothing.
    missions(0);
    const written = recordWrites();

    renderWithProviders(<FirstRun />);
    await completeTour();

    await waitFor(() => expect(written["goal"]).toBeDefined());
    const goal = written["goal"] as { targets: { kind: string; target: { hours: number } }[] };
    expect(goal.targets[0]?.kind).toBe("focus_hours");
    expect(goal.targets[0]?.target.hours).toBe(10);
  });

  it("captures a pasted URL rather than asking for a title", async () => {
    // The cheapest possible win, and the thing worth showing off.
    missions(0);
    const written = recordWrites();

    renderWithProviders(<FirstRun />);
    await completeTour();

    await waitFor(() => expect(written["capture"]).toBeDefined());
    expect(written["capture"]).toMatchObject({
      url: "https://doc.rust-lang.test/ch04",
      missionId: MISSION_ID,
    });
  });

  it("starts a 15-minute session on the mission and the resource", async () => {
    // Ending inside the core loop is the point: the habit is the product.
    missions(0);
    const written = recordWrites();

    renderWithProviders(<FirstRun />);
    await completeTour();

    await waitFor(() => expect(written["session"]).toBeDefined());
    expect(written["session"]).toMatchObject({
      missionId: MISSION_ID,
      resourceId: RESOURCE_ID,
      intention: "read chapter 4",
      plannedMinutes: 15,
    });
  });

  it("says at the end that none of it was demo data", async () => {
    missions(0);
    recordWrites();

    renderWithProviders(<FirstRun />);
    await completeTour();

    expect(await screen.findByText(/Nothing here was demo data/)).toBeVisible();
  });

  it("offers a resource with no link, because a book has none to paste", async () => {
    missions(0);
    const written = recordWrites();

    renderWithProviders(<FirstRun />);
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    await userEvent.type(screen.getByLabelText("What are you working on?"), "Rust");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(await screen.findByLabelText("What do you want to be true?"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    await userEvent.click(
      await screen.findByRole("button", { name: "It's a book or something without a link" }),
    );
    await userEvent.type(screen.getByLabelText("What is it called?"), "Programming Rust");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(written["resource"]).toBeDefined());
    expect(written["resource"]).toMatchObject({ title: "Programming Rust", type: "book" });
    expect(written["capture"]).toBeUndefined();
  });
});

describe("explaining itself", () => {
  it("says why the 'why' is being asked", async () => {
    // A form that does not explain itself gets filled in with whatever is fastest, and this is the field
    // every later feature reads.
    missions(0);
    renderWithProviders(<FirstRun />);

    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(screen.getByText(/The why is not decoration/)).toBeVisible();
  });

  it("says that goals here are measured rather than declared", async () => {
    missions(0);
    recordWrites();
    renderWithProviders(<FirstRun />);

    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    await userEvent.type(screen.getByLabelText("What are you working on?"), "Rust");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText(/measured, not declared/)).toBeVisible();
  });
});

describe("skipping and resuming", () => {
  it("is skippable at the first step", async () => {
    missions(0);
    const { container } = renderWithProviders(<FirstRun />);

    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip this" }));

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("offers to resume from where it stopped", async () => {
    missions(0);
    recordWrites();
    const { unmount } = renderWithProviders(<FirstRun />);

    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    await userEvent.type(screen.getByLabelText("What are you working on?"), "Rust");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByLabelText("What do you want to be true?");
    unmount();

    // The mission now exists, so the account is no longer empty — and the offer must still appear, or
    // the user is abandoned at step 2.
    missions(1);
    renderWithProviders(<FirstRun />);
    expect(await screen.findByText(/Pick up at step 2 of 4/)).toBeVisible();
  });

  it("does not create a second mission when resumed", async () => {
    // The reason the created ids are part of the stored state.
    missions(0);
    const written = recordWrites();
    const { unmount } = renderWithProviders(<FirstRun />);

    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    await userEvent.type(screen.getByLabelText("What are you working on?"), "Rust");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByLabelText("What do you want to be true?");
    unmount();

    delete written["mission"];
    missions(1);
    renderWithProviders(<FirstRun />);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));

    // Straight to step 2, with no mission written.
    expect(await screen.findByLabelText("What do you want to be true?")).toBeVisible();
    expect(written["mission"]).toBeUndefined();
  });
});

describe("when a step is refused", () => {
  it("shows why and keeps the typing", async () => {
    missions(0);
    server.use(
      http.post(`${API}/missions`, () =>
        problemResponse(422, "validation-failed", "That topic is too long."),
      ),
    );

    renderWithProviders(<FirstRun />);
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));

    const box = screen.getByLabelText("What are you working on?");
    await userEvent.type(box, "Rust ownership");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That topic is too long.");
    expect(box).toHaveValue("Rust ownership");
  });

  it("stays on the step rather than advancing", async () => {
    missions(0);
    server.use(
      http.post(`${API}/missions`, () => problemResponse(422, "validation-failed", "No.")),
    );

    renderWithProviders(<FirstRun />);
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    await userEvent.type(screen.getByLabelText("What are you working on?"), "Rust");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    await screen.findByRole("alert");
    expect(screen.queryByLabelText("What do you want to be true?")).not.toBeInTheDocument();
  });
});

describe("pt-BR", () => {
  it("renders the tour in Portuguese", async () => {
    missions(0);
    renderWithProviders(<FirstRun />, { locale: "pt-BR" });

    expect(await screen.findByText(/Configure sua primeira missão/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Começar" }));
    expect(screen.getByText("O que você quer melhorar, e por quê?")).toBeVisible();
  });
});
