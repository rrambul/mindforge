import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../test/msw.js";
import { renderWithProviders } from "../test/render.js";
import { GoalsScreen } from "./GoalsScreen.js";

vi.mock("../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    kind: "focus_hours",
    weight: 1,
    fraction: 0.5,
    met: false,
    unmeasurable: null,
    metAt: null,
    resourceId: null,
    skillId: null,
    missionId: crypto.randomUUID(),
    target: { hours: 40 },
    ...overrides,
  };
}

function goal(overrides: Record<string, unknown> = {}) {
  const targets = (overrides["targets"] as object[]) ?? [target()];
  return {
    id: crypto.randomUUID(),
    missionId: null,
    title: "Understand ownership properly",
    definitionOfDone: null,
    targetDate: null,
    status: "active",
    outcomeNote: null,
    fraction: 0.5,
    targetCount: targets.length,
    measuredWeight: targets.length,
    totalWeight: targets.length,
    allTargetsMet: false,
    targets,
    createdAt: "2026-08-06T12:00:00.000Z",
    ...overrides,
  };
}

/** The screen also reads resources and missions for the target pickers. */
function goalsReturning(byStatus: Record<string, object[]>, seen: string[] = []) {
  server.use(
    http.get(`${API}/goals`, ({ request }) => {
      const status = new URL(request.url).searchParams.get("status") ?? "";
      seen.push(status);
      return HttpResponse.json({ goals: byStatus[status] ?? byStatus[""] ?? [] });
    }),
    http.get(`${API}/resources`, () => HttpResponse.json({ resources: [] })),
    http.get(`${API}/missions`, () => HttpResponse.json({ missions: [] })),
  );
  return seen;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("progress is never invented (§3.8)", () => {
  it("says a goal with no targets cannot be measured, rather than showing 0%", async () => {
    // Either number would be a made-up claim, and the absence is the nudge to add a target.
    goalsReturning({ "": [goal({ targets: [], targetCount: 0, fraction: null })] });

    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByText(/No targets yet/)).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("distinguishes 'no targets' from 'targets that cannot be measured'", async () => {
    // Two different facts. In the second the user has done the work of defining the goal and the app
    // cannot see it — telling them there are no targets would be wrong and would suggest the wrong fix.
    goalsReturning({
      "": [
        goal({
          fraction: null,
          targets: [
            target({ kind: "artifact", fraction: null, unmeasurable: "not_yet_implemented" }),
          ],
        }),
      ],
    });

    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByText("Nothing here can be measured yet.")).toBeVisible();
    expect(screen.queryByText(/No targets yet/)).not.toBeInTheDocument();
  });

  it("shows no bar at all when nothing can be measured", async () => {
    // A track with an empty fill reads as 0%, which is a different and false claim.
    goalsReturning({ "": [goal({ fraction: null })] });

    renderWithProviders(<GoalsScreen />);
    await screen.findByText("Understand ownership properly");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("draws the bar at the fraction the server computed", async () => {
    goalsReturning({ "": [goal({ fraction: 0.75 })] });

    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  });

  it("says how much of the goal the number covers when only some targets are measurable", async () => {
    // A mean over half the weight presented as *the* progress is not wrong, it is just not the whole
    // claim it appears to be.
    goalsReturning({
      "": [
        goal({
          fraction: 0.5,
          measuredWeight: 1,
          totalWeight: 2,
          targetCount: 2,
          targets: [
            target({ fraction: 0.5 }),
            target({ kind: "artifact", fraction: null, unmeasurable: "not_yet_implemented" }),
          ],
        }),
      ],
    });

    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByText(/Measuring 1 of 2 targets/)).toBeVisible();
  });

  it("has no control anywhere that sets a percentage", async () => {
    // The rule the feature exists for. A number input on a computed target would be a slider by
    // another name.
    goalsReturning({ "": [goal()] });

    renderWithProviders(<GoalsScreen />);
    await screen.findByText("Understand ownership properly");

    // The only number inputs on the screen belong to the create form's date, and there is none of
    // those until it is opened.
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
});

describe("a target row", () => {
  it("says why an unmeasurable target cannot be measured", async () => {
    // "Nothing to measure yet" is about the user's evidence; "not until that part exists" is about the
    // app. Telling someone the second as if it were the first sends them off to do work that cannot help.
    goalsReturning({
      "": [
        goal({
          fraction: null,
          targets: [
            target({
              kind: "resource_progress",
              fraction: null,
              unmeasurable: "no_data",
              target: { percent: 100 },
            }),
          ],
        }),
      ],
    });

    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByText("Nothing to measure this against yet.")).toBeVisible();
  });

  it("describes what the target asks for, in words", async () => {
    goalsReturning({ "": [goal({ targets: [target({ target: { hours: 40 } })] })] });

    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByText("Spend 40h focused")).toBeVisible();
  });

  it("translates a band from the glossary rather than showing the stored value", async () => {
    goalsReturning({
      "": [
        goal({
          fraction: null,
          targets: [
            target({
              kind: "skill_band",
              fraction: null,
              unmeasurable: "not_yet_implemented",
              missionId: null,
              skillId: crypto.randomUUID(),
              target: { band: "fluent" },
            }),
          ],
        }),
      ],
    });

    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByText("Reach the Fluent band")).toBeVisible();
  });

  it("reads accuracy as a percentage even though it is stored as a fraction", async () => {
    goalsReturning({
      "": [
        goal({
          fraction: null,
          targets: [
            target({
              kind: "review_accuracy",
              fraction: null,
              unmeasurable: "not_yet_implemented",
              missionId: null,
              skillId: crypto.randomUUID(),
              target: { accuracy: 0.85, windowDays: 30 },
            }),
          ],
        }),
      ],
    });

    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByText("Hold 85% accuracy over 30 days")).toBeVisible();
  });

  describe("the manual escape hatch", () => {
    it("offers a toggle, and sends a boolean", async () => {
      goalsReturning({
        "": [
          goal({
            fraction: 0,
            targets: [target({ kind: "manual", fraction: 0, missionId: null, target: {} })],
          }),
        ],
      });
      const sent = vi.fn();
      server.use(
        http.patch(`${API}/goals/:id/targets/:targetId/manual`, async ({ request }) => {
          sent(await request.json());
          return HttpResponse.json(goal());
        }),
      );

      renderWithProviders(<GoalsScreen />);
      await userEvent.click(await screen.findByRole("button", { name: "Not done yet" }));

      await waitFor(() => expect(sent).toHaveBeenCalledWith({ satisfied: true }));
    });

    it("offers no toggle on a computed target", async () => {
      // §3.8 made visible: if a focus_hours row had a control, the honest thing it could do is open
      // the timer and the dishonest thing is let you type a number.
      goalsReturning({ "": [goal({ targets: [target({ kind: "focus_hours" })] })] });

      renderWithProviders(<GoalsScreen />);
      await screen.findByText("Spend 40h focused");
      expect(screen.queryByRole("button", { name: "Not done yet" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    });
  });
});

describe("all targets met", () => {
  it("prompts rather than closing the goal itself", async () => {
    // Closing is a decision. Auto-closing would take the outcome note with it, which is the only part
    // worth reading later.
    goalsReturning({ "": [goal({ fraction: 1, allTargetsMet: true })] });

    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByText(/Every target is met/)).toBeVisible();
    // Still active, still closable by hand.
    expect(screen.getByRole("button", { name: "Close goal" })).toBeVisible();
  });
});

describe("closing a goal", () => {
  it("offers missing it as an equal option", async () => {
    // A goal that is allowed to fail is a goal you will write down honestly next time.
    goalsReturning({ "": [goal()] });

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Close goal" }));

    const how = screen.getByLabelText("How did it end?");
    expect(within(how).getByRole("option", { name: "Missed it" })).toBeInTheDocument();
    expect(within(how).getByRole("option", { name: "Dropped it" })).toBeInTheDocument();
  });

  it("will not close a missed goal without a note", async () => {
    goalsReturning({ "": [goal()] });

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Close goal" }));
    await userEvent.selectOptions(screen.getByLabelText("How did it end?"), "missed");

    expect(screen.getByRole("button", { name: "Close it" })).toBeDisabled();
    expect(screen.getByText(/needs a note/)).toBeVisible();
  });

  it("closes as met with no note at all", async () => {
    goalsReturning({ "": [goal()] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/goals/:id/close`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(goal({ status: "met" }));
      }),
    );

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Close goal" }));
    await userEvent.click(screen.getByRole("button", { name: "Close it" }));

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ status: "met" }));
  });

  it("sends the note for a missed goal", async () => {
    goalsReturning({ "": [goal()] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/goals/:id/close`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(goal({ status: "missed" }));
      }),
    );

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Close goal" }));
    await userEvent.selectOptions(screen.getByLabelText("How did it end?"), "missed");
    await userEvent.type(screen.getByLabelText("What happened?"), "ran out of time");
    await userEvent.click(screen.getByRole("button", { name: "Close it" }));

    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith({ status: "missed", outcomeNote: "ran out of time" }),
    );
  });

  it("states a closed goal's outcome plainly, with no editorial", async () => {
    goalsReturning({
      "": [goal({ status: "missed", outcomeNote: "ran out of time", fraction: 0.3 })],
    });

    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByText("ran out of time")).toBeVisible();
    // No add-target or close controls on something already over; reopening is the only move.
    expect(screen.getByRole("button", { name: "Reopen" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Close goal" })).not.toBeInTheDocument();
  });
});

describe("writing a goal down", () => {
  it("takes a title alone", async () => {
    goalsReturning({ "": [] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/goals`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(goal(), { status: 201 });
      }),
    );

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Write down a goal" }));
    await userEvent.type(screen.getByLabelText("What do you want to be true?"), "Ship the parser");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    const body = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.title).toBe("Ship the parser");
    expect(body.targets).toEqual([]);
    // Not a percentage in sight.
    expect(body).not.toHaveProperty("fraction");
  });

  it("sends the target date as the day typed, with no Date in between", async () => {
    // A `type="date"` input gives `YYYY-MM-DD`, which is exactly what the API wants — so the day
    // cannot shift for anyone west of UTC.
    goalsReturning({ "": [] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/goals`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(goal(), { status: 201 });
      }),
    );

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Write down a goal" }));
    await userEvent.type(screen.getByLabelText("What do you want to be true?"), "x");
    await userEvent.type(screen.getByLabelText("By when"), "2026-09-30");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect((sent.mock.calls[0]?.[0] as Record<string, unknown>).targetDate).toBe("2026-09-30");
  });

  it("will not submit without a title", async () => {
    goalsReturning({ "": [] });
    renderWithProviders(<GoalsScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Write down a goal" }));
    expect(screen.getByRole("button", { name: "Add goal" })).toBeDisabled();
  });

  it("keeps the typing when the server refuses it", async () => {
    goalsReturning({ "": [] });
    server.use(
      http.post(`${API}/goals`, () =>
        problemResponse(422, "validation-failed", "That will not do."),
      ),
    );

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Write down a goal" }));
    const box = screen.getByLabelText("What do you want to be true?");
    await userEvent.type(box, "Ship the parser");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That will not do.");
    expect(box).toHaveValue("Ship the parser");
  });

  it("shows the target date exactly as stored", async () => {
    goalsReturning({ "": [goal({ targetDate: "2026-09-30" })] });
    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByText("2026-09-30")).toBeVisible();
  });
});

describe("adding a target", () => {
  it("offers every kind, including the ones that cannot be measured yet", async () => {
    // Writing down "ship an artifact" is honest. Hiding it would push people to record it as a manual
    // target and lose the type information the day artifacts exist.
    goalsReturning({ "": [goal()] });

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a target" }));

    const kind = screen.getByLabelText("Measure by");
    expect(within(kind).getByRole("option", { name: "Artifact" })).toBeInTheDocument();
    expect(within(kind).getByRole("option", { name: "You decide" })).toBeInTheDocument();
  });

  it("says so when the chosen kind cannot be measured yet", async () => {
    goalsReturning({ "": [goal()] });

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a target" }));
    await userEvent.selectOptions(screen.getByLabelText("Measure by"), "artifact");

    expect(
      screen.getByText("This can't be measured until that part of the app exists."),
    ).toBeVisible();
  });

  it("sends a manual target with no subject and no number", async () => {
    goalsReturning({ "": [goal()] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/goals/:id/targets`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(goal());
      }),
    );

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a target" }));
    await userEvent.selectOptions(screen.getByLabelText("Measure by"), "manual");
    await userEvent.click(screen.getByRole("button", { name: "Add target" }));

    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith({ kind: "manual", target: {}, weight: 1 }),
    );
  });

  it("picks a mission by name rather than by uuid", async () => {
    const missionId = crypto.randomUUID();
    server.use(
      http.get(`${API}/goals`, () => HttpResponse.json({ goals: [goal()] })),
      http.get(`${API}/resources`, () => HttpResponse.json({ resources: [] })),
      http.get(`${API}/missions`, () =>
        HttpResponse.json({ missions: [{ id: missionId, topic: "Rust ownership" }] }),
      ),
    );
    const sent = vi.fn();
    server.use(
      http.post(`${API}/goals/:id/targets`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(goal());
      }),
    );

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a target" }));
    await userEvent.selectOptions(screen.getByLabelText("Measure by"), "focus_hours");
    expect(await screen.findByRole("option", { name: "Rust ownership" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Hours"), "40");
    await userEvent.click(screen.getByRole("button", { name: "Add target" }));

    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith({
        kind: "focus_hours",
        missionId,
        target: { hours: 40 },
        weight: 1,
      }),
    );
  });

  it("removes a target", async () => {
    const existing = target();
    goalsReturning({ "": [goal({ targets: [existing] })] });
    const deleted = vi.fn();
    server.use(
      http.delete(`${API}/goals/:id/targets/:targetId`, ({ params }) => {
        deleted(params["targetId"]);
        return HttpResponse.json(goal({ targets: [], targetCount: 0, fraction: null }));
      }),
    );

    renderWithProviders(<GoalsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleted).toHaveBeenCalledWith(existing.id));
  });
});

describe("filtering", () => {
  it("filters on the server", async () => {
    const seen = goalsReturning({ "": [goal()], met: [] });

    renderWithProviders(<GoalsScreen />);
    await screen.findByText("Understand ownership properly");

    await userEvent.selectOptions(screen.getByLabelText("Show"), "met");
    await waitFor(() => expect(seen).toContain("met"));
  });

  it("labels the filter from the glossary, so the vocabulary cannot drift", async () => {
    goalsReturning({ "": [goal()] });
    renderWithProviders(<GoalsScreen />);

    const filter = await screen.findByLabelText("Show");
    expect(within(filter).getByRole("option", { name: "Dropped" })).toBeInTheDocument();
  });

  it("distinguishes no goals from an empty filter", async () => {
    goalsReturning({ "": [goal()], met: [] });

    renderWithProviders(<GoalsScreen />);
    await screen.findByText("Understand ownership properly");

    await userEvent.selectOptions(screen.getByLabelText("Show"), "met");
    expect(await screen.findByText("Nothing in this list.")).toBeVisible();
  });

  it("invites a first goal when there are none", async () => {
    goalsReturning({ "": [] });
    renderWithProviders(<GoalsScreen />);
    expect(await screen.findByText(/measured by targets rather than by a feeling/)).toBeVisible();
  });
});

describe("pt-BR", () => {
  it("renders the screen and the goal vocabulary in Portuguese", async () => {
    goalsReturning({ "": [goal({ status: "active" })] });

    renderWithProviders(<GoalsScreen />, { locale: "pt-BR" });

    const card = (await screen.findByText("Understand ownership properly")).closest("article");
    expect(screen.getByText("Metas")).toBeVisible();
    // Translated once in the glossary and derived everywhere (§5.2).
    expect(within(card as HTMLElement).getByText("Ativa")).toBeVisible();
    expect(within(card as HTMLElement).getByText("Horas de foco")).toBeVisible();
    // The ICU description, with its number in the right place for the language.
    expect(within(card as HTMLElement).getByText("Passar 40h em foco")).toBeVisible();
  });
});
