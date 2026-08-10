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
 * The wrapper, not the panel.
 *
 * `InsightsRoute` is covered against its props in `features/insights`; what only this file can prove
 * is that the profile's calendar is actually plugged in.
 */

function insightsReturning(options: { me?: object } = {}) {
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
    http.get(`${API}/insights/activity`, () =>
      HttpResponse.json({
        from: "2026-03-09",
        to: "2026-03-15",
        cells: [],
        activeDaysIn28: 0,
        signal: null,
        rebuiltAt: null,
      }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("what only the app layer can join up", () => {
  it("renders the grid once the profile has arrived", async () => {
    insightsReturning();

    renderWithProviders(<InsightsScreen />);

    expect(await screen.findByText("Active days in the last 28")).toBeInTheDocument();
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
