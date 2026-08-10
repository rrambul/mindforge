import { screen, waitFor, within } from "@testing-library/react";
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
  return { day, value: 0, intensity: 0, ...overrides };
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
    cells: QUIET_WEEK,
    activeDaysIn28: 0,
    signal: null,
    rebuiltAt: "2026-03-15T03:00:00.000Z",
    ...overrides,
  };
}

/** Records the search each activity request carried, so the range is observable. */
function insightsReturning(responses: { grid?: object } = {}, seen: URLSearchParams[] = []) {
  server.use(
    http.get(`${API}/insights/activity`, ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json(responses.grid ?? grid());
    }),
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

describe("the activity grid (FR-Q1)", () => {
  it("shades a day by its minutes and says what they were", async () => {
    insightsReturning({
      grid: grid({
        cells: [
          ...QUIET_WEEK.slice(0, 5),
          cell("2026-03-14", { value: 135, intensity: 3 }),
          QUIET_WEEK[6],
        ],
      }),
    });

    renderRoute();

    const day = await screen.findByRole("img", { name: /Mar 14, 2026/ });
    expect(Number(day.style.opacity)).toBeGreaterThan(0);
    expect(day).toHaveAccessibleName(/2 hr 15 min focused/);
  });

  it("leaves an empty day neutral rather than shading it", async () => {
    // Rest days are part of the design. No shading of shame.
    insightsReturning();
    renderRoute();

    const day = await screen.findByRole("img", { name: /Mar 14, 2026/ });
    expect(day).toHaveAttribute("data-empty", "true");
    expect(day.style.opacity).toBe("");
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

describe("the figure beside the grid (FR-Q1)", () => {
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
  });

  it("names the weekday you have never worked on", async () => {
    insightsReturning({
      grid: grid({ signal: { kind: "never_on_weekday", weekday: 6 } }),
    });

    renderRoute();

    expect(await screen.findByText(/never once logged a Saturday/)).toBeVisible();
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

describe("failure", () => {
  it("reports the failure and offers a retry", async () => {
    server.use(
      http.get(`${API}/insights/activity`, () =>
        problemResponse(500, "internal", "Something went wrong on our side."),
      ),
    );

    renderRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

describe("pt-BR", () => {
  it("renders the screen and the units in Portuguese", async () => {
    insightsReturning({
      grid: grid({
        activeDaysIn28: 15,
        cells: [
          ...QUIET_WEEK.slice(0, 5),
          cell("2026-03-14", { value: 135, intensity: 3 }),
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
    expect(screen.getByRole("img", { name: /2 h 15 min de foco/ })).toBeInTheDocument();
  });
});
