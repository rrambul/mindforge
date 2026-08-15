import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { API, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { SpendPanel } from "./SpendPanel.js";

/**
 * What teaching has cost (FR-T8).
 *
 * Every assertion here is about a claim the panel must *not* make: no total when the
 * total is a floor, no bar when nothing is capped, and no percentage anywhere. The
 * ledger behind it existed from M3 and was read by nothing, so the risk is not that
 * the number is missing — it is that a number appears and is wrong in a way nobody
 * can see.
 */

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

function returns(spend: Record<string, unknown>) {
  server.use(
    http.get(`${API}/teach/spend`, () =>
      HttpResponse.json({
        day: "2026-08-08",
        spentUsd: 0,
        capUsd: 15,
        remainingUsd: 15,
        fraction: 0,
        exhausted: false,
        unpricedCalls: 0,
        atLeast: false,
        ...spend,
      }),
    ),
  );
}

describe("the meter", () => {
  it("shows what today cost against the cap", async () => {
    returns({ spentUsd: 2.5, remainingUsd: 12.5, fraction: 0.1667 });
    renderWithProviders(<SpendPanel />);

    expect(await screen.findByText("$2.50 today")).toBeVisible();
    expect(screen.getByText("$2.50 of $15.00")).toBeVisible();
  });

  it("never renders a percentage", async () => {
    // M4's rule, and it applies to money for the same reason it applies to a plan:
    // the bar is a second channel for the figure, and the figure stays money.
    returns({ spentUsd: 7.5, remainingUsd: 7.5, fraction: 0.5 });
    const { container } = renderWithProviders(<SpendPanel />);

    await screen.findByText("$7.50 today");
    expect(container.textContent).not.toMatch(/\d+\s*%/);
  });

  it("draws a bar in cents, so a small spend against a large cap is still visible", async () => {
    // Dollars would round 2.50 and 15 to integers and draw 2/15 of a bar as 0.
    returns({ spentUsd: 2.5, remainingUsd: 12.5 });
    renderWithProviders(<SpendPanel />);

    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "250");
    expect(bar).toHaveAttribute("aria-valuemax", "1500");
    // A screen reader hears the money, not a ratio.
    expect(bar).toHaveAttribute("aria-valuetext", "$2.50 of $15.00");
  });
});

describe("what it refuses to claim", () => {
  it("says 'at least' when some calls could not be priced", async () => {
    // A model missing from the pricing table leaves a null `cost_usd`. Printing the
    // sum as a total would be understating a bill (non-negotiable 10).
    returns({ spentUsd: 4.1, unpricedCalls: 3, atLeast: true });
    renderWithProviders(<SpendPanel />);

    expect(await screen.findByText("At least $4.10 today")).toBeVisible();
    expect(screen.getByText(/3 calls couldn't be priced/)).toBeVisible();
  });

  it("draws no bar at all when the install has no cap", async () => {
    // An empty bar claims a measurement against a limit nobody set.
    returns({ spentUsd: 40, capUsd: null, remainingUsd: null, fraction: null });
    renderWithProviders(<SpendPanel />);

    expect(await screen.findByText("$40.00 today")).toBeVisible();
    expect(screen.getByText(/No daily limit is set/)).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("says when the limit resets rather than only that it was reached", async () => {
    returns({ spentUsd: 15, remainingUsd: 0, fraction: 1, exhausted: true });
    renderWithProviders(<SpendPanel />);

    expect(await screen.findByText(/resets at midnight in your timezone/)).toBeVisible();
  });

  it("states that it could not read the figure rather than showing nothing", async () => {
    // A silent meter is indistinguishable from a day with no spending.
    server.use(http.get(`${API}/teach/spend`, () => HttpResponse.json({}, { status: 500 })));
    renderWithProviders(<SpendPanel />);

    expect(await screen.findByText("Couldn't read today's spending.")).toBeVisible();
  });
});

describe("currency", () => {
  it("stays in dollars in pt-BR, because that is what was charged", async () => {
    // `Intl.NumberFormat` against the UI locale would render `R$ 2,50` and name a
    // currency nobody was billed in.
    returns({ spentUsd: 2.5, remainingUsd: 12.5 });
    renderWithProviders(<SpendPanel />, { locale: "pt-BR" });

    expect(await screen.findByText("$2.50 hoje")).toBeVisible();
  });
});
