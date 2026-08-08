import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { API, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { TeachPanel } from "./TeachPanel.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

/**
 * What the learner can tell about a run from the card.
 *
 * A teach run costs money and takes minutes, so "what state is mine in" has to be
 * answerable without opening anything. Two of these assert on wording rather than
 * on structure, deliberately: a conflicted run is a *success* and must not read
 * like a failure, and a partial index has to be visible or §7.4's degradation
 * rule stops meaning anything.
 */

const MISSION = "11111111-1111-4111-8111-111111111111";

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    missionId: MISSION,
    kind: "generate_lesson",
    status: "succeeded",
    error: null,
    result: null,
    createdAt: "2026-08-08T12:00:00.000Z",
    startedAt: "2026-08-08T12:00:01.000Z",
    finishedAt: "2026-08-08T12:04:00.000Z",
    ...overrides,
  };
}

function runsServer(runs: object[], onStart?: () => object) {
  server.use(
    http.get(`${API}/missions/${MISSION}/agent-runs`, () => HttpResponse.json(runs)),
    http.post(`${API}/missions/${MISSION}/teach`, () =>
      HttpResponse.json(onStart?.() ?? run({ status: "queued" }), { status: 202 }),
    ),
  );
}

beforeEach(() => {
  runsServer([]);
});

describe("starting a run", () => {
  it("offers the button when nothing is running", async () => {
    renderWithProviders(<TeachPanel missionId={MISSION} />);

    expect(await screen.findByRole("button", { name: "Teach me the next thing" })).toBeEnabled();
  });

  it("queues a run when pressed", async () => {
    let started = false;
    runsServer([], () => {
      started = true;
      return run({ status: "queued" });
    });

    renderWithProviders(<TeachPanel missionId={MISSION} />);
    await userEvent.click(await screen.findByRole("button", { name: "Teach me the next thing" }));

    await waitFor(() => {
      expect(started).toBe(true);
    });
  });
});

describe("while a run is live", () => {
  it("says what is happening rather than only disabling the button", async () => {
    // The honest answer to a five-minute wait is not a spinner. It also says the
    // page can be left, because it can.
    runsServer([run({ status: "running", finishedAt: null })]);

    renderWithProviders(<TeachPanel missionId={MISSION} />);

    expect(await screen.findByText(/Writing you a lesson/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Teaching…" })).toBeDisabled();
  });

  it("disables rather than hides the button, so the page does not look broken", async () => {
    runsServer([run({ status: "queued", startedAt: null, finishedAt: null })]);

    renderWithProviders(<TeachPanel missionId={MISSION} />);

    expect(await screen.findByRole("button", { name: "Teaching…" })).toBeInTheDocument();
  });
});

describe("after a run", () => {
  it("counts the lessons it wrote", async () => {
    runsServer([
      run({ result: { changes: { added: ["lessons/0001-x.html"], modified: [], deleted: [] } } }),
    ]);

    renderWithProviders(<TeachPanel missionId={MISSION} />);

    expect(await screen.findByText("Done — one new lesson.")).toBeInTheDocument();
  });

  it("reads a conflicted run as a success, not a failure", async () => {
    // §7.4: the work landed and both versions were kept. Wording it as a failure
    // pushes people toward re-running, which makes more conflicts — so the copy
    // leads with "nothing was overwritten".
    runsServer([
      run({
        status: "succeeded_with_conflicts",
        result: {
          changes: { added: ["lessons/0001-x.html"], modified: [], deleted: [] },
          conflicts: [{ path: "MISSION.md", reason: "changed_in_storage" }],
        },
      }),
    ]);

    renderWithProviders(<TeachPanel missionId={MISSION} />);

    expect(await screen.findByText(/Both versions were kept/u)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was overwritten/u)).toBeInTheDocument();
    expect(screen.getByText("MISSION.md")).toBeInTheDocument();
  });

  it("surfaces what could not be indexed", async () => {
    // "Stored, partially indexed" is only a useful rule if the partiality reaches
    // somebody. Rendered from the warning's own key, so it translates.
    runsServer([
      run({
        result: {
          changes: { added: ["lessons/0002-y.html"], modified: [], deleted: [] },
          warnings: [{ code: "filename_unnumbered", args: { filename: "closures.html" } }],
        },
      }),
    ]);

    renderWithProviders(<TeachPanel missionId={MISSION} />);

    expect(await screen.findByText(/wasn't indexed/u)).toBeInTheDocument();
    expect(screen.getByText(/closures\.html has no number/u)).toBeInTheDocument();
  });

  it("shows a warning code nobody has written a message for, rather than hiding it", async () => {
    // A gap in the locale files is a gap worth seeing. The parsers grow a warning
    // kind faster than two locales do, and "something wasn't indexed" tells the
    // learner nothing they can act on.
    runsServer([
      run({
        result: {
          changes: { added: ["lessons/0002-y.html"], modified: [], deleted: [] },
          warnings: [{ code: "some_future_warning" }],
        },
      }),
    ]);

    renderWithProviders(<TeachPanel missionId={MISSION} />);

    expect(await screen.findByText("some_future_warning")).toBeInTheDocument();
  });

  it("says a failed run did not finish", async () => {
    runsServer([run({ status: "failed", error: "The run finished without writing a lesson." })]);

    renderWithProviders(<TeachPanel missionId={MISSION} />);

    expect(await screen.findByText("That run didn't finish.")).toBeInTheDocument();
  });

  it("offers the button again once the run is over", async () => {
    runsServer([run({ status: "succeeded" })]);

    renderWithProviders(<TeachPanel missionId={MISSION} />);

    expect(await screen.findByRole("button", { name: "Teach me the next thing" })).toBeEnabled();
  });
});
