import type { IsoDate } from "@mindforge/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import type { AllocationView, LabelledPlanRow } from "../api/use-planning.js";
import type { PlanSubjectOption } from "../model/allocation-draft.js";
import { WeekRoute } from "./WeekRoute.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const WEEK = "2026-08-03" as IsoDate;

const RUST: PlanSubjectOption = { kind: "mission", id: "m1", label: "Rust" };
const OWNERSHIP: PlanSubjectOption = { kind: "skill", id: "s1", label: "Ownership" };

/** The week as the API stores it. A fresh object each call so a test cannot mutate the next one's. */
function planReturning(allocations: AllocationView[]) {
  server.use(
    http.get(`${API}/plans/:weekStart`, () =>
      HttpResponse.json({
        weekStart: WEEK,
        allocations,
        plannedTotal: allocations.reduce((sum, a) => sum + a.plannedMinutes, 0),
      }),
    ),
  );
}

function actualReturning(rows: LabelledPlanRow[]) {
  const plannedTotal = rows.reduce((sum, row) => sum + (row.plannedMinutes ?? 0), 0);
  const actualTotal = rows.reduce((sum, row) => sum + row.actualMinutes, 0);
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
  );
}

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

function renderWeek(options: { subjects?: PlanSubjectOption[]; locale?: "en" | "pt-BR" } = {}) {
  return renderWithProviders(
    <WeekRoute
      weekStart={WEEK}
      subjects={options.subjects ?? [RUST, OWNERSHIP]}
      subjectsPending={false}
      nav={null}
    />,
    options.locale ? { locale: options.locale } : {},
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the allocation grid (FR-F5)", () => {
  it("gives every mission and every skill a box, prefilled from the stored week", async () => {
    planReturning([{ missionId: "m1", skillId: null, plannedMinutes: 240 }]);
    actualReturning([]);

    renderWeek();

    expect(await screen.findByLabelText("Rust")).toHaveValue(240);
    // A subject the week never allocated to is empty, not zero — the box is a target, and 0 would be
    // one the schema refuses.
    expect(screen.getByLabelText("Ownership")).toHaveValue(null);
  });

  it("saves the whole week in one PUT, because the grid is one decision", async () => {
    planReturning([{ missionId: "m1", skillId: null, plannedMinutes: 240 }]);
    actualReturning([]);
    const sent = vi.fn();
    server.use(
      http.put(`${API}/plans/:weekStart`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({ weekStart: WEEK, allocations: [], plannedTotal: 0 });
      }),
    );

    renderWeek();
    await userEvent.type(await screen.findByLabelText("Ownership"), "60");
    await userEvent.click(screen.getByRole("button", { name: "Save the week" }));

    // The untouched mission travels with the edit. Two independent requests could land in either
    // order and leave the week over-allocated in between.
    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith({
        allocations: [
          { missionId: "m1", plannedMinutes: 240 },
          { skillId: "s1", plannedMinutes: 60 },
        ],
      }),
    );
  });

  it("removes an allocation when its box is cleared", async () => {
    planReturning([{ missionId: "m1", skillId: null, plannedMinutes: 240 }]);
    actualReturning([]);
    const sent = vi.fn();
    server.use(
      http.put(`${API}/plans/:weekStart`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({ weekStart: WEEK, allocations: [], plannedTotal: 0 });
      }),
    );

    renderWeek();
    await userEvent.clear(await screen.findByLabelText("Rust"));
    await userEvent.click(screen.getByRole("button", { name: "Save the week" }));

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ allocations: [] }));
  });

  it("never sends a zero, because the API refuses one", async () => {
    // Typing 0 is how people say "drop this". Sending it would 422 on a rule the user has no way to
    // read, so it becomes a removed row instead.
    planReturning([{ missionId: "m1", skillId: null, plannedMinutes: 240 }]);
    actualReturning([]);
    const sent = vi.fn();
    server.use(
      http.put(`${API}/plans/:weekStart`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({ weekStart: WEEK, allocations: [], plannedTotal: 0 });
      }),
    );

    renderWeek();
    const box = await screen.findByLabelText("Rust");
    await userEvent.clear(box);
    await userEvent.type(box, "0");
    await userEvent.click(screen.getByRole("button", { name: "Save the week" }));

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ allocations: [] }));
  });

  it("will not offer to save a week nobody has changed", async () => {
    planReturning([{ missionId: "m1", skillId: null, plannedMinutes: 240 }]);
    actualReturning([]);

    renderWeek();
    await screen.findByLabelText("Rust");
    expect(screen.getByRole("button", { name: "Save the week" })).toBeDisabled();
  });

  it("blocks the save on a figure past the ceiling and says which box", async () => {
    planReturning([]);
    actualReturning([]);

    renderWeek();
    await userEvent.type(await screen.findByLabelText("Rust"), "99999");

    expect(screen.getByRole("button", { name: "Save the week" })).toBeDisabled();
    expect(screen.getByText(/Whole minutes, up to/)).toBeVisible();
  });

  it("lets an untouched row follow the server rather than a copy taken on mount", async () => {
    // §2.2 rule 1. Seeding `useState` from the query would silently discard a plan changed in another
    // tab, and the symptom is a grid that saves numbers nobody can see any more.
    planReturning([{ missionId: "m1", skillId: null, plannedMinutes: 240 }]);
    actualReturning([]);

    const { queryClient } = renderWeek();
    expect(await screen.findByLabelText("Rust")).toHaveValue(240);

    planReturning([{ missionId: "m1", skillId: null, plannedMinutes: 90 }]);
    await queryClient.invalidateQueries({ queryKey: ["planning"] });

    await waitFor(() => expect(screen.getByLabelText("Rust")).toHaveValue(90));
  });

  it("keeps your typing when the save is refused", async () => {
    planReturning([]);
    actualReturning([]);
    server.use(
      http.put(`${API}/plans/:weekStart`, () =>
        problemResponse(422, "validation-failed", "That mission is parked."),
      ),
    );

    renderWeek();
    await userEvent.type(await screen.findByLabelText("Rust"), "120");
    await userEvent.click(screen.getByRole("button", { name: "Save the week" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("parked");
    expect(screen.getByLabelText("Rust")).toHaveValue(120);
  });

  it("says out loud that a target with no box will be dropped", async () => {
    // A mission parked after the week was planned. The PUT sends only what the grid holds, so the
    // target disappears on the next save — silently would be a form that lies about what it does.
    planReturning([{ missionId: "gone", skillId: null, plannedMinutes: 120 }]);
    actualReturning([]);

    renderWeek();
    expect(await screen.findByText(/point at something parked or deleted/)).toBeVisible();
  });

  it("names what to do first when there is nothing to allocate to", async () => {
    planReturning([]);
    actualReturning([]);

    renderWeek({ subjects: [] });
    expect(await screen.findByText(/Start a mission or add a skill/)).toBeVisible();
  });

  it("retries a week that could not be read, and draws it once it arrives", async () => {
    let attempts = 0;
    server.use(
      http.get(`${API}/plans/:weekStart`, () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.error()
          : HttpResponse.json({
              weekStart: WEEK,
              allocations: [{ missionId: "m1", skillId: null, plannedMinutes: 240 }],
              plannedTotal: 240,
            });
      }),
    );
    actualReturning([]);

    renderWeek();
    // A request that never reached the server has no `detail` to show, so it says so in its own
    // words rather than the API's.
    expect(await screen.findByText(/didn't reach the server/)).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Rust")).toHaveValue(240);
  });
});

describe("plan versus actual (FR-F5)", () => {
  it("shows planned, actual and the delta for a row that moved", async () => {
    planReturning([]);
    actualReturning([plannedRow("m1", 240, 90, "Rust")]);

    renderWeek();
    await screen.findByText("Plan vs. actual");

    expect(screen.getByText("2 hr 30 min under")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: /Rust/ })).toHaveAttribute(
      "aria-valuenow",
      "38",
    );
  });

  it("draws a planned row with no minutes as a real zero", async () => {
    // The one place an empty bar is honest: you said four hours of Rust and did none. Null would be a
    // dodge, and the delta is the whole target.
    planReturning([]);
    actualReturning([plannedRow("m1", 240, 0, "Rust")]);

    renderWeek();
    await screen.findByText("Plan vs. actual");

    expect(screen.getByRole("progressbar", { name: /Rust/ })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("4 hr under")).toBeVisible();
  });

  it("renders unplanned work as work you did without planning it, not as a percentage", async () => {
    // Two hours against a plan of nothing is not 200%, not ∞, and not "over target".
    planReturning([]);
    actualReturning([unplannedRow("s1", 120, "Ownership")]);

    renderWeek();
    expect(await screen.findByText(/Worked on without planning it/)).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("says a week had no plan rather than showing it as 0%", async () => {
    planReturning([]);
    actualReturning([unplannedRow("s1", 120, "Ownership")]);

    renderWeek();
    expect(await screen.findByText("Nothing planned")).toBeVisible();
  });

  it("says a row's subject no longer exists rather than inventing a name", async () => {
    // The API sends `label: null` on purpose. The minutes are real, so dropping the row would quietly
    // change the totals.
    planReturning([]);
    actualReturning([unplannedRow("s1", 45, null)]);

    renderWeek();
    expect(await screen.findByText("No longer exists")).toBeVisible();
  });

  it("marks an overshoot without letting the bar overflow its own track", async () => {
    planReturning([]);
    actualReturning([plannedRow("m1", 60, 120, "Rust")]);

    renderWeek();
    const bar = await screen.findByRole("progressbar", { name: /Rust/ });

    expect(bar).toHaveAttribute("aria-valuenow", "200");
    // A screen reader announces a value above its own max as broken markup.
    expect(bar).toHaveAttribute("aria-valuemax", "200");
    expect(bar.firstElementChild).toHaveAttribute("data-over", "true");
    expect(bar.firstElementChild).toHaveStyle({ width: "100%" });
  });

  it("retries the comparison rather than leaving the week looking empty", async () => {
    // The failure mode this guards: a failed `actual` query renders the same as a week with nothing
    // in it, so without a stated error the screen would quietly claim you did no work.
    planReturning([]);
    let attempts = 0;
    server.use(
      http.get(`${API}/plans/:weekStart/actual`, () => {
        attempts += 1;
        if (attempts === 1) return HttpResponse.error();
        return HttpResponse.json({
          weekStart: WEEK,
          rows: [plannedRow("m1", 60, 60, "Rust")],
          plannedTotal: 60,
          actualTotal: 60,
          unplannedMinutes: 0,
          attainment: 1,
        });
      }),
    );

    renderWeek();
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Plan vs. actual")).toBeVisible();
    expect(screen.getByText("On target")).toBeVisible();
  });

  it("draws no comparison at all for a week with neither a plan nor a minute", async () => {
    // §5.3: a block with nothing to say is absent. A table of "0 of 0" is the manufactured insight
    // that trains you to stop reading them.
    planReturning([]);
    actualReturning([]);

    renderWeek();
    await screen.findByLabelText("Rust");
    expect(screen.queryByText("Plan vs. actual")).not.toBeInTheDocument();
  });
});

describe("pt-BR", () => {
  it("formats the week's minutes in the locale's own units", async () => {
    planReturning([{ missionId: "m1", skillId: null, plannedMinutes: 90 }]);
    actualReturning([plannedRow("m1", 90, 45, "Rust")]);

    renderWeek({ locale: "pt-BR" });
    await screen.findByText("Plano x realizado");

    // "1 h 30 min", not the English "1 hr 30 min" — the unit is the locale's, never a hardcoded
    // letter.
    const card = screen.getByRole("region", { name: "Plano x realizado" });
    expect(within(card).getByText("45 min a menos")).toBeVisible();
  });
});
