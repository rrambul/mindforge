import type { IsoDate } from "@mindforge/core";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import type { FrictionSplitView } from "../api/use-week-friction.js";
import { ThisWeekBlock } from "./ThisWeekBlock.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const WEEK = "2026-08-03" as IsoDate;

function week(totals: {
  plannedTotal: number;
  actualTotal: number;
  attainment: number | null;
  split?: Partial<FrictionSplitView>;
}) {
  server.use(
    http.get(`${API}/plans/:weekStart/actual`, () =>
      HttpResponse.json({
        weekStart: WEEK,
        rows: [],
        plannedTotal: totals.plannedTotal,
        actualTotal: totals.actualTotal,
        unplannedMinutes: 0,
        attainment: totals.attainment,
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
        ...totals.split,
      }),
    ),
  );
}

function renderBlock() {
  return renderWithProviders(<ThisWeekBlock weekStart={WEEK} timeZone="America/Sao_Paulo" />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Today's THIS WEEK block (§5.3)", () => {
  it("draws planned against actual as one bar", async () => {
    week({ plannedTotal: 240, actualTotal: 90, attainment: 90 / 240 });

    renderBlock();
    const bar = await screen.findByRole("progressbar", {
      name: "Minutes worked against minutes planned",
    });

    expect(bar).toHaveAttribute("aria-valuenow", "38");
    expect(screen.getByText("1 hr 30 min of 4 hr planned — 38%")).toBeVisible();
  });

  it("shows the minutes without a bar when the week had no plan", async () => {
    // No plan is not a plan of zero. The minutes are the honest half of the comparison, and the
    // sentence says which half is missing.
    week({ plannedTotal: 0, actualTotal: 120, attainment: null });

    renderBlock();
    expect(await screen.findByText(/Nothing was planned for it/)).toBeVisible();
    expect(screen.getByText("2 hr")).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("leaves the ember/slag bar out when nothing was attributed", async () => {
    // Every other screen explains a null share in a sentence. On Today that sentence is the filler
    // §5.3 rules out — this block is context on the way into a session, not a dashboard.
    week({ plannedTotal: 240, actualTotal: 90, attainment: 90 / 240 });

    renderBlock();
    await screen.findByText(/of 4 hr planned/);
    expect(screen.queryByText(/ember/i)).not.toBeInTheDocument();
  });

  it("draws the ember share when there is one", async () => {
    week({
      plannedTotal: 240,
      actualTotal: 90,
      attainment: 90 / 240,
      split: { eventCount: 3, emberMinutes: 60, slagMinutes: 20, emberShare: 0.75 },
    });

    renderBlock();
    expect(await screen.findByText("75% of the friction minutes so far were ember.")).toBeVisible();
  });

  it("renders nothing for a week with no plan, no minutes and no split", async () => {
    const answered = vi.fn();
    server.use(
      http.get(`${API}/plans/:weekStart/actual`, () => {
        answered();
        return HttpResponse.json({
          weekStart: WEEK,
          rows: [],
          plannedTotal: 0,
          actualTotal: 0,
          unplannedMinutes: 0,
          attainment: null,
        });
      }),
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

    const { container } = renderBlock();
    // Waited for, so this asserts "nothing to say" rather than "not answered yet".
    await waitFor(() => expect(answered).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows no placeholder while the week is loading", async () => {
    // Today's first pixel is information and its budget is ≤5s to a started session. A skeleton that
    // resolves to "no data" costs attention every single morning.
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/plans/:weekStart/actual`, async () => {
        await held;
        return HttpResponse.json({
          weekStart: WEEK,
          rows: [],
          plannedTotal: 60,
          actualTotal: 60,
          unplannedMinutes: 0,
          attainment: 1,
        });
      }),
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

    const { container } = renderBlock();
    expect(container).toBeEmptyDOMElement();

    release();
    expect(await screen.findByText("This week")).toBeVisible();
  });
});
