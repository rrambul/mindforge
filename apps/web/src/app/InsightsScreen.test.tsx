import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, server } from "../test/msw.js";
import { renderWithProviders } from "../test/render.js";
import { InsightsScreen } from "./InsightsScreen.js";

vi.mock("../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

/**
 * The wrapper, not the panels.
 *
 * `InsightsRoute` is covered against its props in `features/insights`; what only this file can prove
 * is that the two things §2.2 rule 6 forces through the app layer are actually plugged in. The
 * failure this guards against is the one CLAUDE.md opens with — a contract that was ready on both
 * sides with nothing joining them, which looks identical to a finished feature until you read the
 * screen.
 */

const STALLED_ID = "7b1d0f52-3a4c-4f9e-8d21-6c0a5e2b9f43";

function resource(overrides: Record<string, unknown> = {}) {
  return {
    id: STALLED_ID,
    type: "book",
    title: "Designing Data-Intensive Applications",
    author: null,
    url: null,
    status: "reading",
    abandonReason: null,
    progress: null,
    fraction: null,
    isMeasurable: false,
    missionIds: [],
    skillIds: [],
    addedAt: "2026-01-04T12:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

function insightsReturning(
  options: { resources?: object[]; me?: object; stalled?: object[] } = {},
) {
  server.use(
    http.get(`${API}/me`, () =>
      HttpResponse.json(
        options.me ?? {
          userId: "u1",
          locale: "en",
          timezone: "America/Sao_Paulo",
          weekStartsOn: 1,
        },
      ),
    ),
    http.get(`${API}/resources`, () =>
      HttpResponse.json({ resources: options.resources ?? [resource()] }),
    ),
    http.get(`${API}/insights/activity`, () =>
      HttpResponse.json({
        from: "2026-03-09",
        to: "2026-03-15",
        layer: "focus",
        cells: [],
        activeDaysIn28: 0,
        signal: null,
        rebuiltAt: null,
      }),
    ),
    http.get(`${API}/insights/backlog`, () =>
      HttpResponse.json({
        windowDays: 28,
        added: 0,
        resolved: 0,
        netChange: 0,
        openCount: 1,
        oldestOpenDays: 40,
        medianOpenAgeDays: 40,
        stalled: options.stalled ?? [
          { id: STALLED_ID, untouchedDays: 26, lastTouchedOn: "2026-02-17" },
        ],
        abandoned: 0,
        finished: 0,
        abandonmentRate: null,
        abandonReasons: [],
        abandonment: { total: 0, reasons: [] },
        signal: null,
      }),
    ),
    http.get(`${API}/insights/friction`, () =>
      HttpResponse.json({
        eventCount: 0,
        byType: [],
        byMission: [],
        unattributed: { total: 0, standalone: 0, sessionWithoutMission: 0 },
      }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("what only the app layer can join up", () => {
  it("names a stalled item from the library the feature may not import", async () => {
    insightsReturning();

    renderWithProviders(<InsightsScreen />);

    expect(
      await screen.findByText(/Designing Data-Intensive Applications — 26 days untouched/),
    ).toBeInTheDocument();
  });

  it("says an item is gone rather than guessing when the library has no such id", async () => {
    // A stalled id with no resource behind it is a real state — the row was deleted — and the
    // lookup returning null has to reach the copy that admits it.
    insightsReturning({ resources: [] });

    renderWithProviders(<InsightsScreen />);

    expect(
      await screen.findByText(/An item no longer in your library — 26 days untouched/),
    ).toBeInTheDocument();
  });

  it("waits for the profile before asking for a year of days", async () => {
    // The grid's range is part of its query key. Starting on a guessed timezone means fetching a
    // year twice and, far enough from UTC, watching the whole grid shift a column when the real
    // one lands.
    const asked: string[] = [];
    server.use(
      http.get(`${API}/me`, () => HttpResponse.json({}, { status: 500 })),
      http.get(`${API}/insights/activity`, ({ request }) => {
        asked.push(request.url);
        return HttpResponse.json({});
      }),
    );

    renderWithProviders(<InsightsScreen />);

    expect(await screen.findByText("Loading")).toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });
});
