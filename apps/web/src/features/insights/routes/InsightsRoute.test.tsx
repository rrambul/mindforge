import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { InsightsRoute } from "./InsightsRoute.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

function cell(day: string, overrides: Record<string, unknown> = {}) {
  return { day, value: 0, intensity: 0, emberShare: null, ...overrides };
}

/** A week of nothing, which is the base every test varies one cell of. */
const QUIET_WEEK = [
  cell("2026-03-09"),
  cell("2026-03-10"),
  cell("2026-03-11"),
  cell("2026-03-12"),
  cell("2026-03-13"),
  cell("2026-03-14"),
  cell("2026-03-15"),
];

function grid(overrides: Record<string, unknown> = {}) {
  return {
    from: "2026-03-09",
    to: "2026-03-15",
    layer: "focus",
    cells: QUIET_WEEK,
    activeDaysIn28: 0,
    signal: null,
    rebuiltAt: "2026-03-15T03:00:00.000Z",
    ...overrides,
  };
}

function backlog(overrides: Record<string, unknown> = {}) {
  return {
    windowDays: 28,
    added: 0,
    resolved: 0,
    netChange: 0,
    openCount: 0,
    oldestOpenDays: null,
    medianOpenAgeDays: null,
    stalled: [],
    abandoned: 0,
    finished: 0,
    abandonmentRate: null,
    abandonReasons: [],
    abandonment: { total: 0, reasons: [] },
    signal: null,
    ...overrides,
  };
}

function friction(overrides: Record<string, unknown> = {}) {
  return {
    eventCount: 0,
    byType: [],
    byMission: [],
    unattributed: { total: 0, standalone: 0, sessionWithoutMission: 0 },
    ...overrides,
  };
}

/** Records the search each activity request carried, so the layer switch is observable. */
function insightsReturning(
  responses: { grid?: object; backlog?: object; friction?: object } = {},
  seen: URLSearchParams[] = [],
) {
  server.use(
    http.get(`${API}/insights/activity`, ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json(responses.grid ?? grid());
    }),
    http.get(`${API}/insights/backlog`, () => HttpResponse.json(responses.backlog ?? backlog())),
    http.get(`${API}/insights/friction`, () => HttpResponse.json(responses.friction ?? friction())),
  );
  return seen;
}

function renderRoute(props: Partial<Parameters<typeof InsightsRoute>[0]> = {}) {
  return renderWithProviders(
    <InsightsRoute timezone="America/Sao_Paulo" weekStartsOn={1} {...props} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the activity grid's two channels (FR-I6b, §3.9)", () => {
  it("gives a day with no logged friction no hue at all", async () => {
    // The single most important rule on this screen. Grey is the slag end of a *measured* scale;
    // a day you did not annotate has not been measured, and shading it grey would say "you spent
    // a lot and got little" about a day nobody assessed.
    insightsReturning({
      grid: grid({
        cells: [
          ...QUIET_WEEK.slice(0, 5),
          cell("2026-03-14", { value: 135, intensity: 3, emberShare: null }),
          QUIET_WEEK[6],
        ],
      }),
    });

    renderRoute();

    const day = await screen.findByRole("img", { name: /Mar 14, 2026/ });
    expect(day).toHaveAttribute("data-measured", "false");
    expect(day.style.getPropertyValue("--mf-cell-hue")).toBe("");
  });

  it("still shows the minutes on that day, because the work did happen", async () => {
    insightsReturning({
      grid: grid({
        cells: [
          ...QUIET_WEEK.slice(0, 5),
          cell("2026-03-14", { value: 135, intensity: 3, emberShare: null }),
          QUIET_WEEK[6],
        ],
      }),
    });

    renderRoute();

    const day = await screen.findByRole("img", { name: /Mar 14, 2026/ });
    expect(Number(day.style.opacity)).toBeGreaterThan(0);
    expect(day).toHaveAccessibleName(/2 hr 15 min focused/);
    expect(day).toHaveAccessibleName(/No friction logged/);
  });

  it("mixes the hue from the day's own ember share when there is one", async () => {
    insightsReturning({
      grid: grid({
        cells: [
          ...QUIET_WEEK.slice(0, 5),
          cell("2026-03-14", { value: 135, intensity: 4, emberShare: 0.75 }),
          QUIET_WEEK[6],
        ],
      }),
    });

    renderRoute();

    const day = await screen.findByRole("img", { name: /Mar 14, 2026/ });
    expect(day).toHaveAttribute("data-measured", "true");
    expect(day.style.getPropertyValue("--mf-cell-hue")).toBe(
      "color-mix(in oklab, var(--mf-ember) 75%, var(--mf-slag))",
    );
  });

  it("draws a day of pure slag as a measurement, not as an absence", async () => {
    // The mirror of the first test: zero *is* the answer here, and the cell has to carry it.
    insightsReturning({
      grid: grid({
        cells: [
          ...QUIET_WEEK.slice(0, 5),
          cell("2026-03-14", { value: 240, intensity: 4, emberShare: 0 }),
          QUIET_WEEK[6],
        ],
      }),
    });

    renderRoute();

    const day = await screen.findByRole("img", { name: /Mar 14, 2026/ });
    expect(day).toHaveAttribute("data-measured", "true");
    expect(day.style.getPropertyValue("--mf-cell-hue")).toContain("var(--mf-ember) 0%");
  });

  it("leaves an empty day neutral rather than shading it", async () => {
    // Rest days are part of the design (§3.9). No shading of shame.
    insightsReturning();
    renderRoute();

    const day = await screen.findByRole("img", { name: /Mar 14, 2026/ });
    expect(day).toHaveAttribute("data-empty", "true");
    expect(day).not.toHaveAttribute("data-measured");
    expect(day.style.opacity).toBe("");
  });

  it("counts the notes layer in notes rather than in minutes", async () => {
    insightsReturning({
      grid: grid({
        layer: "notes",
        cells: [
          ...QUIET_WEEK.slice(0, 5),
          cell("2026-03-14", { value: 3, intensity: 2, emberShare: 0.5 }),
          QUIET_WEEK[6],
        ],
      }),
    });

    renderRoute();

    expect(await screen.findByRole("img", { name: /Mar 14, 2026: 3 notes/ })).toBeInTheDocument();
  });

  it("scrolls inside its own container rather than widening the page", async () => {
    // jsdom cannot prove the page body does not scroll; what it can prove is that the year lives
    // in one labelled, focusable scroll region of its own (§5.1).
    insightsReturning();
    renderRoute();

    const region = await screen.findByRole("group", { name: /Activity grid/ });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getAllByRole("img")).toHaveLength(7);
  });
});

describe("the figure beside the grid (FR-N5)", () => {
  it("reports active days in the last 28", async () => {
    insightsReturning({ grid: grid({ activeDaysIn28: 15 }) });
    renderRoute();

    expect(await screen.findByText("Active days in the last 28")).toBeVisible();
    expect(screen.getByText("15")).toBeVisible();
  });

  it("is not a streak, and says so", async () => {
    // A counter that resets to zero is a punishment, and punishment corrupts the data.
    insightsReturning({ grid: grid({ activeDaysIn28: 15 }) });
    renderRoute();

    expect(await screen.findByText(/Not a streak/)).toBeVisible();
  });
});

describe("the one derived line", () => {
  it("renders nothing at all when there is no signal", async () => {
    // §5.3: a manufactured insight trains you to stop reading them. Not a placeholder, not an
    // empty box — nothing.
    insightsReturning();
    renderRoute();

    await screen.findByText("Active days in the last 28");
    expect(screen.queryByText(/never once logged/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your last four weeks average/)).not.toBeInTheDocument();
  });

  it("names the weekday you have never worked on", async () => {
    insightsReturning({
      grid: grid({ signal: { kind: "never_on_weekday", weekday: 6 } }),
    });

    renderRoute();

    expect(await screen.findByText(/never once logged a Saturday/)).toBeVisible();
  });

  it("sets your pace against the plan, and names the choice", async () => {
    insightsReturning({
      grid: grid({
        signal: { kind: "pace_below_plan", averageActiveDays: 3.2, plannedDays: 5 },
      }),
    });

    renderRoute();

    expect(await screen.findByText(/average 3.2 active days/)).toBeVisible();
    expect(screen.getByText(/assume 5/)).toBeVisible();
  });
});

describe("layers", () => {
  it("offers exactly the two that have a source", async () => {
    // §3.9 names five; reviews, lessons and artifacts have no table until M4–M6, and a disabled
    // option would teach you the grid is decoration.
    insightsReturning();
    renderRoute();

    const picker = await screen.findByLabelText("Show");
    expect(within(picker).getAllByRole("option")).toHaveLength(2);
    expect(within(picker).getByRole("option", { name: "Focus time" })).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "Notes captured" })).toBeInTheDocument();
  });

  it("asks the server for the layer you picked", async () => {
    const seen = insightsReturning();
    renderRoute();

    await userEvent.selectOptions(await screen.findByLabelText("Show"), "notes");

    await waitFor(() => expect(seen.map((s) => s.get("layer"))).toContain("notes"));
  });

  it("asks for a year of days", async () => {
    const seen = insightsReturning();
    renderRoute();

    await waitFor(() => expect(seen).not.toHaveLength(0));
    const first = seen[0]!;
    const from = new Date(`${first.get("from")!}T00:00:00Z`).getTime();
    const to = new Date(`${first.get("to")!}T00:00:00Z`).getTime();
    expect(Math.round((to - from) / 86_400_000)).toBe(364);
  });
});

describe("the rollup's own honesty", () => {
  it("says when the range has never been rolled up, so quiet and broken look different", async () => {
    insightsReturning({ grid: grid({ rebuiltAt: null }) });
    renderRoute();

    expect(await screen.findByText(/has been rolled up yet/)).toBeVisible();
  });

  it("dates the rollup in the profile's timezone when there is one", async () => {
    insightsReturning({ grid: grid({ rebuiltAt: "2026-03-15T03:00:00.000Z" }) });
    renderRoute();

    // 03:00 UTC is midnight in São Paulo.
    expect(await screen.findByText(/Rolled up Mar 15, 2026, 12:00 AM/)).toBeVisible();
  });
});

describe("backlog health (FR-I7)", () => {
  it("sets growth against throughput", async () => {
    insightsReturning({
      backlog: backlog({ added: 6, resolved: 2, netChange: 4, openCount: 11 }),
    });

    renderRoute();

    const panel = await screen.findByRole("region", { name: "Backlog" });
    expect(within(panel).getByText("The queue grew by 4.")).toBeVisible();
    expect(within(panel).getByText("6")).toBeVisible();
  });

  it("says nothing is open rather than reporting an age of zero", async () => {
    insightsReturning({ backlog: backlog({ openCount: 0 }) });
    renderRoute();

    const panel = await screen.findByRole("region", { name: "Backlog" });
    expect(within(panel).getByText(/Nothing is open/)).toBeVisible();
    expect(within(panel).queryByText(/Median: 0 days/)).not.toBeInTheDocument();
  });

  it("reports the ages when something is open", async () => {
    insightsReturning({
      backlog: backlog({ openCount: 11, oldestOpenDays: 179, medianOpenAgeDays: 119 }),
    });

    renderRoute();

    expect(await screen.findByText(/Oldest open item: 179 days/)).toBeVisible();
    expect(screen.getByText(/Median: 119 days/)).toBeVisible();
  });

  it("names the stalled items when the screen can name them", async () => {
    insightsReturning({
      backlog: backlog({
        stalled: [
          { id: "r1", untouchedDays: 154, lastTouchedOn: "2026-03-01" },
          { id: "r2", untouchedDays: 52, lastTouchedOn: null },
        ],
      }),
    });

    renderRoute({ resourceName: (id) => (id === "r1" ? "MIT 6.824" : null) });

    expect(await screen.findByText("MIT 6.824 — 154 days untouched")).toBeVisible();
    expect(screen.getByText(/Last opened Sun, Mar 1, 2026/)).toBeVisible();
    // Unnamed rather than dropped: a count you cannot act on is worse than a row with no title.
    expect(screen.getByText(/no longer in your library — 52 days untouched/)).toBeVisible();
    expect(screen.getByText("Never opened since you added it.")).toBeVisible();
  });

  it("refuses to call an undatable abandonment a rate of zero", async () => {
    // `resources` records *that* you quit and never *when*, so the numerator is unknowable. Zero
    // would read as "you never quit anything", which is the opposite of true here.
    insightsReturning({
      backlog: backlog({
        resolved: 2,
        abandoned: 1,
        finished: 1,
        abandonmentRate: null,
        abandonment: { total: 3, reasons: [{ reason: "too_shallow", count: 1 }] },
      }),
    });

    renderRoute();

    expect(await screen.findByText(/No rate: the 3 resources you have stopped/)).toBeVisible();
    expect(screen.queryByText(/0% of what you resolved/)).not.toBeInTheDocument();
  });

  it("warns that the counts beside an undatable abandonment are bounds", async () => {
    insightsReturning({
      backlog: backlog({ abandonment: { total: 3, reasons: [] } }),
    });

    renderRoute();

    expect(await screen.findByText(/bounds rather than counts/)).toBeVisible();
    expect(screen.getByText(/None of them said why/)).toBeVisible();
  });

  it("says nothing resolved rather than showing a rate of zero", async () => {
    insightsReturning({
      backlog: backlog({
        resolved: 0,
        abandonmentRate: null,
        abandonment: { total: 0, reasons: [] },
      }),
    });

    renderRoute();

    expect(await screen.findByText(/Nothing was finished or stopped/)).toBeVisible();
  });

  it("states the rate plainly when it can be computed", async () => {
    insightsReturning({
      backlog: backlog({
        resolved: 4,
        abandoned: 1,
        finished: 3,
        abandonmentRate: 0.25,
        abandonment: { total: 0, reasons: [] },
      }),
    });

    renderRoute();

    expect(await screen.findByText(/25% of what you resolved/)).toBeVisible();
  });

  it("names the action when the queue is stalling", async () => {
    insightsReturning({
      backlog: backlog({ signal: { kind: "stalling", count: 4, days: 21 } }),
    });

    renderRoute();

    expect(await screen.findByText(/4 items have sat untouched for 21 days/)).toBeVisible();
  });

  it("says nothing when there is no signal", async () => {
    insightsReturning();
    renderRoute();

    await screen.findByRole("region", { name: "Backlog" });
    expect(screen.queryByText(/The queue is growing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pick one and decide/)).not.toBeInTheDocument();
  });
});

describe("friction analytics (FR-I3)", () => {
  it("ranks the types and carries the mean intensity", async () => {
    insightsReturning({
      friction: friction({
        eventCount: 14,
        byType: [
          { type: "tooling", count: 9, meanIntensity: 3.4 },
          { type: "avoidance", count: 5, meanIntensity: 2 },
        ],
        unattributed: { total: 0, standalone: 0, sessionWithoutMission: 0 },
      }),
    });

    renderRoute();

    const bar = await screen.findByRole("progressbar", { name: "Tooling" });
    expect(bar).toHaveAttribute("aria-valuenow", "9");
    expect(screen.getByText("Mean intensity 3.4 of 5")).toBeVisible();
  });

  it("shows friction with no mission as unattributed rather than hiding it", async () => {
    // A standalone tap genuinely has no mission (FR-C1). Dropping it would make the mission bars
    // look like the whole story while the counts quietly failed to add up.
    insightsReturning({
      friction: friction({
        eventCount: 14,
        byType: [{ type: "tooling", count: 14, meanIntensity: 3 }],
        byMission: [{ missionId: "m1", topic: "Rust", count: 9 }],
        unattributed: { total: 5, standalone: 3, sessionWithoutMission: 2 },
      }),
    });

    renderRoute();

    const bar = await screen.findByRole("progressbar", { name: "No mission" });
    expect(bar).toHaveAttribute("aria-valuenow", "5");
    expect(
      screen.getByText(/3 logged outside a session, 2 in a session that was never attached/),
    ).toBeVisible();
  });

  it("calls an empty window an absence of data rather than a quiet month", async () => {
    insightsReturning();
    renderRoute();

    expect(await screen.findByText(/absence of data, not a quiet month/)).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("failure", () => {
  it("fails one panel at a time", async () => {
    // Three independent endpoints. A backlog query that 500s must not take the year of days down.
    server.use(
      http.get(`${API}/insights/activity`, () => HttpResponse.json(grid({ activeDaysIn28: 4 }))),
      http.get(`${API}/insights/backlog`, () =>
        problemResponse(500, "internal", "Something went wrong on our side."),
      ),
      http.get(`${API}/insights/friction`, () => HttpResponse.json(friction())),
    );

    renderRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText("Active days in the last 28")).toBeVisible();
  });
});

describe("pt-BR", () => {
  it("renders the screen, the units, and the temper sentence in Portuguese", async () => {
    insightsReturning({
      grid: grid({
        activeDaysIn28: 15,
        cells: [
          ...QUIET_WEEK.slice(0, 5),
          cell("2026-03-14", { value: 135, intensity: 3, emberShare: 0.75 }),
          QUIET_WEEK[6],
        ],
      }),
    });

    renderWithProviders(<InsightsRoute timezone="America/Sao_Paulo" weekStartsOn={1} />, {
      locale: "pt-BR",
    });

    expect(await screen.findByText("Dias ativos nos últimos 28")).toBeVisible();
    expect(screen.getByText("Análises")).toBeVisible();
    // "2 h 15 min", not a hand-built "2h15".
    expect(
      screen.getByRole("img", { name: /2 h 15 min de foco\. 75% do atrito/ }),
    ).toBeInTheDocument();
  });
});
