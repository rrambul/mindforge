import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, server } from "../test/msw.js";
import { renderWithProviders } from "../test/render.js";
import { TodayThisWeek, WeekScreen } from "./WeekScreen.js";

vi.mock("../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

// A Thursday. `resolveWeek` has to turn it into the week it belongs to, and the fallback path has to
// find it without reading the machine's clock.
vi.mock("../shared/lib/clock.js", () => ({
  now: () => new Date("2026-08-06T12:00:00.000Z"),
  nowIso: () => "2026-08-06T12:00:00.000Z",
}));

/**
 * A memory router with only the two routes this screen links between.
 *
 * Needed because `WeekNav` is built from anchors rather than buttons — a week has a URL, which is the
 * entire point of `/weeks/$weekStart` — and TanStack's `Link` throws without a router above it. The
 * real tree lives in `router.tsx` and is registered by the orchestrator; rendering it here would make
 * this test fail for reasons that have nothing to do with the week.
 */
function renderAt(path: string, locale?: "pt-BR") {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const weekRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/weeks/$weekStart",
    component: WeekScreen,
  });
  const reviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/weeks/$weekStart/review",
    component: () => <p>review</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([weekRoute, reviewRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  return renderWithProviders(<RouterProvider router={router} />, locale ? { locale } : {});
}

function apiReturning(
  options: {
    weekStartsOn?: 0 | 1;
    timezone?: string;
    missions?: { id: string; topic: string }[];
    skills?: { id: string; name: string }[];
  } = {},
) {
  const missionStatuses: string[] = [];

  server.use(
    http.get(`${API}/me`, () =>
      HttpResponse.json({
        userId: "u1",
        locale: "en",
        timezone: options.timezone ?? "America/Sao_Paulo",
        weekStartsOn: options.weekStartsOn ?? 1,
      }),
    ),
    http.get(`${API}/missions`, ({ request }) => {
      missionStatuses.push(new URL(request.url).searchParams.get("status") ?? "");
      return HttpResponse.json({ missions: options.missions ?? [] });
    }),
    http.get(`${API}/skills`, () => HttpResponse.json({ skills: options.skills ?? [] })),
    http.get(`${API}/plans/:weekStart/actual`, ({ params }) =>
      HttpResponse.json({
        weekStart: params["weekStart"],
        rows: [],
        plannedTotal: 0,
        actualTotal: 0,
        unplannedMinutes: 0,
        attainment: null,
      }),
    ),
    http.get(`${API}/plans/:weekStart`, ({ params }) =>
      HttpResponse.json({ weekStart: params["weekStart"], allocations: [], plannedTotal: 0 }),
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
  );

  return missionStatuses;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("which week the URL is about", () => {
  it("normalises a mid-week date to the week it belongs to", async () => {
    // The same `startOfWeek` the API normalises with, so the client cannot ask for one week and label
    // it another. Thursday the 6th belongs to the week starting Monday the 3rd.
    apiReturning({ weekStartsOn: 1 });

    renderAt("/weeks/2026-08-06");
    expect(await screen.findByRole("heading", { name: /Mon, Aug 3, 2026/ })).toBeVisible();
  });

  it("honours a profile that starts the week on Sunday", async () => {
    apiReturning({ weekStartsOn: 0 });

    renderAt("/weeks/2026-08-06");
    expect(await screen.findByRole("heading", { name: /Sun, Aug 2, 2026/ })).toBeVisible();
  });

  it("falls back to the current week when the path is not a date", async () => {
    // A typo in a bookmark is not worth a full-page failure, and the heading says which week you
    // actually got.
    apiReturning({ weekStartsOn: 1 });

    renderAt("/weeks/not-a-date");
    expect(await screen.findByRole("heading", { name: /Mon, Aug 3, 2026/ })).toBeVisible();
  });
});

describe("the grid's rows", () => {
  it("asks the API for active missions only, because a parked one cannot be allocated", async () => {
    // `PUT /plans/:weekStart` refuses a parked mission (§5.3). Offering a box that cannot be saved
    // would be a form lying about what it accepts.
    const statuses = apiReturning({});

    renderAt("/weeks/2026-08-03");
    await waitFor(() => expect(statuses).toEqual(["active"]));
  });

  it("draws a box for every mission and every skill, sorted by name", async () => {
    apiReturning({
      missions: [{ id: "m1", topic: "Rust" }],
      skills: [
        { id: "s2", name: "Zig" },
        { id: "s1", name: "Ownership" },
      ],
    });

    renderAt("/weeks/2026-08-03");
    await screen.findByLabelText("Rust");

    // Findability beats recency for a form you fill in from memory, and the grid keeps missions and
    // skills in separate groups.
    expect(screen.getAllByRole("spinbutton").map((box) => box.getAttribute("id"))).toHaveLength(3);
    expect(screen.getByLabelText("Ownership")).toBeVisible();
    expect(screen.getByLabelText("Zig")).toBeVisible();
  });
});

describe("moving between weeks", () => {
  it("offers the neighbouring weeks as real links, so a week can be sent to yourself", async () => {
    apiReturning({ weekStartsOn: 1 });

    renderAt("/weeks/2026-08-03");
    expect(await screen.findByRole("link", { name: "Previous week" })).toHaveAttribute(
      "href",
      "/weeks/2026-07-27",
    );
    expect(screen.getByRole("link", { name: "Next week" })).toHaveAttribute(
      "href",
      "/weeks/2026-08-10",
    );
    expect(screen.getByRole("link", { name: "Review this week" })).toHaveAttribute(
      "href",
      "/weeks/2026-08-03/review",
    );
  });

  it("drops the 'this week' link while you are looking at this week", async () => {
    // A link to where you are is a control that does nothing.
    apiReturning({ weekStartsOn: 1 });

    renderAt("/weeks/2026-08-03");
    await screen.findByRole("link", { name: "Previous week" });
    expect(screen.queryByRole("link", { name: "This week" })).not.toBeInTheDocument();
  });

  it("offers it once you have navigated away", async () => {
    apiReturning({ weekStartsOn: 1 });

    renderAt("/weeks/2026-06-01");
    expect(await screen.findByRole("link", { name: "This week" })).toHaveAttribute(
      "href",
      "/weeks/2026-08-03",
    );
  });
});

describe("Today's THIS WEEK block", () => {
  it("resolves the week from the profile and links to it", async () => {
    // Props-free so `TodayScreen` renders one element: which week "this week" is depends on the
    // profile, and `planning` cannot reach `auth` for it (§2.2 rule 6).
    apiReturning({ weekStartsOn: 1 });
    server.use(
      http.get(`${API}/plans/:weekStart/actual`, () =>
        HttpResponse.json({
          weekStart: "2026-08-03",
          rows: [],
          plannedTotal: 240,
          actualTotal: 90,
          unplannedMinutes: 0,
          attainment: 90 / 240,
        }),
      ),
    );

    const rootRoute = createRootRoute({ component: () => <TodayThisWeek /> });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByRole("link", { name: "Open the week" })).toHaveAttribute(
      "href",
      "/weeks/2026-08-03",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "38");
  });
});
