import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, server } from "../test/msw.js";
import { renderWithProviders } from "../test/render.js";
import { WeekReviewScreen } from "./WeekReviewScreen.js";

vi.mock("../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

vi.mock("../shared/lib/clock.js", () => ({
  now: () => new Date("2026-08-06T12:00:00.000Z"),
  nowIso: () => "2026-08-06T12:00:00.000Z",
}));

/** The same two-route memory harness `WeekScreen.test.tsx` uses, and for the same reason: links. */
function renderAt(path: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const weekRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/weeks/$weekStart",
    component: () => <p>the week</p>,
  });
  const reviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/weeks/$weekStart/review",
    component: WeekReviewScreen,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([weekRoute, reviewRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  return renderWithProviders(<RouterProvider router={router} />);
}

function apiReturning(actualMinutes = 0) {
  server.use(
    http.get(`${API}/me`, () =>
      HttpResponse.json({
        userId: "u1",
        locale: "en",
        timezone: "America/Sao_Paulo",
        weekStartsOn: 1,
      }),
    ),
    http.get(`${API}/plans/:weekStart/actual`, ({ params }) =>
      HttpResponse.json({
        weekStart: params["weekStart"],
        rows:
          actualMinutes === 0
            ? []
            : [
                {
                  subject: { kind: "mission", id: "m1" },
                  plannedMinutes: 240,
                  actualMinutes,
                  deltaMinutes: actualMinutes - 240,
                  attainment: actualMinutes / 240,
                  label: "Rust",
                },
              ],
        plannedTotal: actualMinutes === 0 ? 0 : 240,
        actualTotal: actualMinutes,
        unplannedMinutes: 0,
        attainment: actualMinutes === 0 ? null : actualMinutes / 240,
      }),
    ),
    http.get(`${API}/plans/:weekStart`, ({ params }) =>
      HttpResponse.json({ weekStart: params["weekStart"], allocations: [], plannedTotal: 0 }),
    ),
    http.get(`${API}/insights/friction`, () =>
      HttpResponse.json({
        eventCount: 0,
        byType: [],
        byMission: [],
        unattributed: { total: 0, standalone: 0, sessionWithoutMission: 0 },
      }),
    ),
    http.get(`${API}/friction/summary`, () =>
      HttpResponse.json({
        eventCount: 0,
        unattributedEventCount: 0,
        emberMinutes: 0,
        slagMinutes: 0,
        emberShare: null,
        byType: {},
      }),
    ),
    http.get(`${API}/reviews/weekly`, () => HttpResponse.json({ reviews: [] })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the weekly review screen (FR-F6)", () => {
  it("names the week the URL asked for, normalised", async () => {
    apiReturning();

    renderAt("/weeks/2026-08-06/review");
    expect(await screen.findByRole("heading", { name: /Mon, Aug 3, 2026/ })).toBeVisible();
  });

  it("links back to the week the review is about", async () => {
    // The review is a screen you arrive at from the plan, and the grid is where a decision made here
    // gets acted on.
    apiReturning();

    renderAt("/weeks/2026-08-03/review");
    expect(await screen.findByRole("link", { name: "Back to the week" })).toHaveAttribute(
      "href",
      "/weeks/2026-08-03",
    );
  });

  it("shares the week navigation with the planning screen", async () => {
    apiReturning();

    renderAt("/weeks/2026-08-03/review");
    expect(await screen.findByRole("link", { name: "Previous week" })).toHaveAttribute(
      "href",
      "/weeks/2026-07-27",
    );
  });

  it("offers next week's grid only once the offer has actually landed", async () => {
    // The grid showing the new targets is a better confirmation than a sentence saying it saved —
    // which is why `Callout` has no success tone.
    apiReturning(90);
    server.use(
      http.put(`${API}/plans/:weekStart`, ({ params }) =>
        HttpResponse.json({ weekStart: params["weekStart"], allocations: [], plannedTotal: 90 }),
      ),
    );

    renderAt("/weeks/2026-08-03/review");
    const apply = await screen.findByRole("button", { name: "Plan next week from this" });
    expect(screen.queryByRole("link", { name: "Open next week" })).not.toBeInTheDocument();

    await userEvent.click(apply);
    expect(await screen.findByRole("link", { name: "Open next week" })).toHaveAttribute(
      "href",
      "/weeks/2026-08-10",
    );
  });
});
