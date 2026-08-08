import type { IsoDate } from "@mindforge/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import type { LabelledPlanRow, WeeklyReviewView } from "../api/use-planning.js";
import type { FrictionSourcesView, FrictionSplitView } from "../api/use-week-friction.js";
import { WeekReviewRoute } from "./WeekReviewRoute.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const WEEK = "2026-08-03" as IsoDate;
const NEXT_WEEK = "2026-08-10";

function plannedRow(
  id: string,
  plannedMinutes: number,
  actualMinutes: number,
  label: string | null = id,
): LabelledPlanRow {
  return {
    subject: { kind: "mission", id },
    plannedMinutes,
    actualMinutes,
    deltaMinutes: actualMinutes - plannedMinutes,
    attainment: actualMinutes / plannedMinutes,
    label,
  };
}

function unplannedRow(id: string, actualMinutes: number, label: string | null): LabelledPlanRow {
  return {
    subject: { kind: "skill", id },
    plannedMinutes: null,
    actualMinutes,
    deltaMinutes: null,
    attainment: null,
    label,
  };
}

const NO_FRICTION: FrictionSourcesView = {
  eventCount: 0,
  byType: [],
  byMission: [],
  unattributed: { total: 0, standalone: 0, sessionWithoutMission: 0 },
};

const NO_SPLIT: FrictionSplitView = {
  eventCount: 0,
  unattributedEventCount: 0,
  emberMinutes: 0,
  slagMinutes: 0,
  emberShare: null,
  byType: {},
};

/**
 * Every query the screen fires, stubbed. MSW runs with `onUnhandledRequest: "error"`, so a screen
 * that grew a sixth request would fail here with the URL rather than time out somewhere else.
 */
function review(
  options: {
    rows?: LabelledPlanRow[];
    sources?: FrictionSourcesView;
    split?: FrictionSplitView;
    reviews?: WeeklyReviewView[];
    nextWeekPlannedMinutes?: number;
  } = {},
) {
  const rows = options.rows ?? [];
  const plannedTotal = rows.reduce((sum, row) => sum + (row.plannedMinutes ?? 0), 0);
  const actualTotal = rows.reduce((sum, row) => sum + row.actualMinutes, 0);
  const nextPlanned = options.nextWeekPlannedMinutes ?? 0;

  server.use(
    http.get(`${API}/plans/:weekStart/actual`, () =>
      HttpResponse.json({
        weekStart: WEEK,
        rows,
        plannedTotal,
        actualTotal,
        unplannedMinutes: rows
          .filter((row) => row.plannedMinutes === null)
          .reduce((sum, row) => sum + row.actualMinutes, 0),
        attainment: plannedTotal === 0 ? null : actualTotal / plannedTotal,
      }),
    ),
    http.get(`${API}/plans/:weekStart`, ({ params }) =>
      HttpResponse.json({
        weekStart: params["weekStart"],
        allocations:
          nextPlanned === 0
            ? []
            : [{ missionId: "old", skillId: null, plannedMinutes: nextPlanned }],
        plannedTotal: nextPlanned,
      }),
    ),
    http.get(`${API}/insights/friction`, () => HttpResponse.json(options.sources ?? NO_FRICTION)),
    http.get(`${API}/friction/summary`, () => HttpResponse.json(options.split ?? NO_SPLIT)),
    // By week, not the capped list: the screen asks for the week it is showing, because scanning a
    // list of 52 made every older week look un-reviewed and its submit an overwrite.
    http.get(`${API}/reviews/weekly/:weekStart`, ({ params }) =>
      HttpResponse.json({
        review: (options.reviews ?? []).find((r) => r.weekStart === params["weekStart"]) ?? null,
      }),
    ),
  );
}

function renderReview(locale?: "pt-BR") {
  return renderWithProviders(
    <WeekReviewRoute weekStart={WEEK} timeZone="America/Sao_Paulo" nav={null} />,
    locale ? { locale } : {},
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("what moved and what stalled (FR-F6)", () => {
  it("keeps the three kinds of row in three blocks", async () => {
    // They are three different facts: a shortfall, an untouched target, and hours that went somewhere
    // you never wrote down. One table would flatten all three into rows.
    review({
      rows: [
        plannedRow("m1", 240, 90, "Rust"),
        plannedRow("m2", 60, 0, "Go"),
        unplannedRow("s1", 45, "Ownership"),
      ],
    });

    renderReview();

    const moved = await screen.findByRole("region", { name: "What moved" });
    expect(within(moved).getByText("Rust")).toBeVisible();

    const stalled = screen.getByRole("region", { name: "What stalled" });
    expect(within(stalled).getByText("Go")).toBeVisible();
    // Zero here is a measurement, and the bar draws it.
    expect(within(stalled).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

    const unplanned = screen.getByRole("region", { name: "What you did without planning it" });
    expect(within(unplanned).getByText("Ownership")).toBeVisible();
    expect(within(unplanned).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("leaves out a block with nothing in it rather than showing it empty", async () => {
    review({ rows: [plannedRow("m1", 240, 90, "Rust")] });

    renderReview();
    await screen.findByRole("region", { name: "What moved" });

    expect(screen.queryByText("What stalled")).not.toBeInTheDocument();
    expect(screen.queryByText("What you did without planning it")).not.toBeInTheDocument();
  });
});

describe("friction sources (FR-I6b)", () => {
  it("ranks the types the server ranked them in, with the taxonomy's own words", async () => {
    review({
      sources: {
        eventCount: 7,
        byType: [
          { type: "tooling", count: 5, meanIntensity: 3.4 },
          { type: "interruption", count: 2, meanIntensity: 2 },
        ],
        byMission: [{ missionId: "m1", topic: "Rust", count: 5 }],
        unattributed: { total: 2, standalone: 1, sessionWithoutMission: 1 },
      },
    });

    renderReview();

    const card = await screen.findByRole("region", { name: "Friction sources" });
    const types = within(card).getAllByRole("listitem");
    expect(within(types[0]!).getByText("Tooling")).toBeVisible();
    expect(within(types[0]!).getByText("5 times")).toBeVisible();
    expect(within(types[0]!).getByText("intensity 3.4")).toBeVisible();
    expect(within(types[1]!).getByText("Interruption")).toBeVisible();
    // Two facts wearing one word, kept apart: taps outside a session, and taps in a session that
    // named no mission.
    expect(within(card).getByText(/1 logged outside a session, 1 inside one/)).toBeVisible();
  });

  it("draws no friction block for a week nobody logged friction in", async () => {
    review({ rows: [plannedRow("m1", 60, 60, "Rust")] });

    renderReview();
    await screen.findByRole("region", { name: "What moved" });
    expect(screen.queryByText("Friction sources")).not.toBeInTheDocument();
  });
});

describe("the ember/slag split (§9.3b)", () => {
  it("draws the two halves against each other", async () => {
    review({
      split: {
        eventCount: 6,
        unattributedEventCount: 0,
        emberMinutes: 90,
        slagMinutes: 30,
        emberShare: 0.75,
        byType: {},
      },
    });

    renderReview();
    const card = await screen.findByRole("region", { name: "Ember and slag" });
    expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  });

  it("says an unattributed split is unmeasured rather than drawing it as all slag", async () => {
    // `emberShare: null` is the product's central rule in one field. A full slag bar would claim every
    // minute of friction was wasted, which is a measurement nobody took.
    review({
      split: {
        eventCount: 4,
        unattributedEventCount: 4,
        emberMinutes: 0,
        slagMinutes: 0,
        emberShare: null,
        byType: {},
      },
    });

    renderReview();
    const card = await screen.findByRole("region", { name: "Ember and slag" });

    expect(within(card).getByText(/Unmeasured, not zero/)).toBeVisible();
    expect(within(card).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("draws no split block at all when no friction was logged", async () => {
    // Different from "logged but unattributable": that one earns a sentence, this one has nothing to
    // say and §5.3 says an absent block beats an empty one.
    review({ rows: [plannedRow("m1", 60, 60, "Rust")] });

    renderReview();
    await screen.findByRole("region", { name: "What moved" });
    expect(screen.queryByText("Ember and slag")).not.toBeInTheDocument();
  });
});

describe("the one thing you are changing (FR-F6)", () => {
  it("records it against the week", async () => {
    review();
    const sent = vi.fn();
    server.use(
      http.post(`${API}/reviews/weekly/:weekStart`, async ({ request, params }) => {
        sent(params["weekStart"], await request.json());
        return HttpResponse.json({
          id: "r1",
          weekStart: WEEK,
          completedAt: "2026-08-10T09:00:00.000Z",
          changedOneThing: "Stop planning Fridays",
          note: null,
        });
      }),
    );

    renderReview();
    await userEvent.type(
      await screen.findByLabelText("What are you changing?"),
      "Stop planning Fridays",
    );
    await userEvent.click(screen.getByRole("button", { name: "Complete the review" }));

    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith(WEEK, {
        changedOneThing: "Stop planning Fridays",
        note: null,
      }),
    );
  });

  it("accepts a review with nothing to change", async () => {
    // A week where nothing needs changing is a real answer. Requiring a sentence would produce a
    // fabricated one, and that is the only record of whether the ritual is doing anything.
    review();
    const sent = vi.fn();
    server.use(
      http.post(`${API}/reviews/weekly/:weekStart`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({
          id: "r1",
          weekStart: WEEK,
          completedAt: "2026-08-10T09:00:00.000Z",
          changedOneThing: null,
          note: null,
        });
      }),
    );

    renderReview();
    await userEvent.click(await screen.findByRole("button", { name: "Complete the review" }));

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ changedOneThing: null, note: null }));
  });

  it("reads through to a review already recorded, and offers to revise it", async () => {
    review({
      reviews: [
        {
          id: "r1",
          weekStart: WEEK,
          completedAt: "2026-08-10T09:00:00.000Z",
          changedOneThing: "Stop planning Fridays",
          note: null,
        },
      ],
    });

    renderReview();
    expect(await screen.findByLabelText("What are you changing?")).toHaveValue(
      "Stop planning Fridays",
    );
    expect(screen.getByRole("button", { name: "Revise the review" })).toBeVisible();
    // When the ritual happened, not when it was last edited.
    expect(screen.getByText(/Reviewed/)).toBeVisible();
  });

  it("does not offer the form until the stored review is known", async () => {
    // The endpoint is an idempotent upsert, so a form rendered empty while the stored review is loading is one
    // press away from erasing last week's sentence — and the request would succeed.
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    review();
    server.use(
      http.get(`${API}/reviews/weekly/:weekStart`, async () => {
        await held;
        return HttpResponse.json({
          review: {
            id: "r1",
            weekStart: WEEK,
            completedAt: "2026-08-10T09:00:00.000Z",
            changedOneThing: "Stop planning Fridays",
            note: null,
          },
        });
      }),
    );

    renderReview();
    await screen.findByText("The one thing you are changing");
    expect(screen.queryByRole("button", { name: "Complete the review" })).not.toBeInTheDocument();

    release();
    expect(await screen.findByLabelText("What are you changing?")).toHaveValue(
      "Stop planning Fridays",
    );
  });

  it("surfaces a refused review rather than swallowing it", async () => {
    review();
    server.use(
      http.post(`${API}/reviews/weekly/:weekStart`, () =>
        problemResponse(422, "validation-failed", "That week has not started yet."),
      ),
    );

    renderReview();
    await userEvent.click(await screen.findByRole("button", { name: "Complete the review" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("has not started yet");
  });
});

describe("next week's allocation — the loop closing (FR-F6)", () => {
  it("prefills from what you actually did, not from the plan that missed", async () => {
    review({ rows: [plannedRow("m1", 240, 90, "Rust")] });
    const sent = vi.fn();
    server.use(
      http.put(`${API}/plans/:weekStart`, async ({ request, params }) => {
        sent(params["weekStart"], await request.json());
        return HttpResponse.json({
          weekStart: params["weekStart"],
          allocations: [],
          plannedTotal: 0,
        });
      }),
    );

    renderReview();
    await userEvent.click(await screen.findByRole("button", { name: "Plan next week from this" }));

    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith(NEXT_WEEK, {
        allocations: [{ missionId: "m1", plannedMinutes: 90 }],
      }),
    );
  });

  it("names the targets it cannot carry forward, joined the way the locale joins lists", async () => {
    // Zero cannot be allocated, so a stalled row can only leave the plan. Vanishing without a word
    // would look like the app deciding you had given up on it.
    review({
      rows: [
        plannedRow("m1", 60, 30, "Rust"),
        plannedRow("m2", 60, 0, "Go"),
        plannedRow("m3", 60, 0, "Elm"),
      ],
    });

    renderReview();
    expect(await screen.findByText(/Go and Elm/)).toBeVisible();
  });

  it("warns that taking the offer replaces a week that is already planned", async () => {
    // `PUT /plans/:weekStart` overwrites. Doing that silently is somebody's Sunday evening.
    review({ rows: [plannedRow("m1", 60, 60, "Rust")], nextWeekPlannedMinutes: 300 });

    renderReview();
    expect(await screen.findByText(/already has 5 hr planned/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Replace next week with this" })).toBeVisible();
  });

  it("offers nothing for a week with no minutes in it", async () => {
    review({ rows: [plannedRow("m1", 60, 0, "Rust")] });

    renderReview();
    await screen.findByRole("region", { name: "What stalled" });
    expect(screen.queryByText("Next week")).not.toBeInTheDocument();
  });
});

describe("the screen's shape (§5.3)", () => {
  it("has exactly one primary action, and it is completing the review", async () => {
    review({ rows: [plannedRow("m1", 60, 60, "Rust")] });

    renderReview();
    await screen.findByRole("button", { name: "Complete the review" });

    const primary = screen
      .getAllByRole("button")
      .filter((button) => button.dataset["variant"] === "primary");
    expect(primary.map((button) => button.textContent)).toEqual(["Complete the review"]);
  });

  it("has no greeting and no encouragement", async () => {
    review({ rows: [plannedRow("m1", 240, 30, "Rust")] });

    renderReview();
    await screen.findByRole("region", { name: "What moved" });
    // A week missed by seven eighths must not be congratulated, and a week hit must not be either.
    expect(screen.queryByText(/great|well done|keep it up|nice/i)).not.toBeInTheDocument();
  });
});

describe("pt-BR", () => {
  it("joins the dropped names with the locale's own conjunction", async () => {
    review({
      rows: [
        plannedRow("m1", 60, 30, "Rust"),
        plannedRow("m2", 60, 0, "Go"),
        plannedRow("m3", 60, 0, "Elm"),
      ],
    });

    renderReview("pt-BR");
    // "Go e Elm" — `join(", ")` would be wrong in both locales, and differently wrong in each.
    expect(await screen.findByText(/Go e Elm/)).toBeVisible();
  });
});

describe("the window the friction figures describe", () => {
  it("closes the week at both ends", async () => {
    // The review shipped with `since` and no `until`, so reviewing the week of the 3rd counted
    // every event since the 3rd — and the screen carried a caption admitting it. Being honest
    // about a wrong number is worse than being right.
    //
    // Asserted on the request rather than on the rendered figures, because the numbers come back
    // from the API either way: a handler that ignores the query string cannot tell the two apart,
    // which is exactly why the earlier tests passed before the bound existed and after it.
    const seen: URL[] = [];
    review({});
    server.use(
      http.get(`${API}/friction/summary`, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(NO_SPLIT);
      }),
      http.get(`${API}/insights/friction`, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(NO_FRICTION);
      }),
    );

    renderReview();
    await waitFor(() => expect(seen).toHaveLength(2));

    for (const url of seen) {
      // São Paulo is UTC−3, so the week beginning Monday the 3rd starts at 03:00Z and the bound is
      // the following Monday at the same instant. Both come from `dayBounds`, which is the same
      // function the API brackets the week with.
      expect(url.searchParams.get("since")).toBe("2026-08-03T03:00:00.000Z");
      expect(url.searchParams.get("until")).toBe("2026-08-10T03:00:00.000Z");
    }
  });
});
