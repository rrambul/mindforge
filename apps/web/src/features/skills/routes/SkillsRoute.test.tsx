import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { SkillsRoute } from "./SkillsRoute.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

function skill(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    name: "Rust ownership",
    slug: "rust-ownership",
    description: null,
    perceivedLevel: null,
    score: null,
    scoreStdDev: null,
    band: null,
    perceivedBand: null,
    feather: "vague",
    halfLifeDays: 90,
    lastEvidenceAt: null,
    calibrationGap: null,
    calibrationVerdict: null,
    calibrationMissing: "both",
    bandGap: null,
    prerequisiteIds: [],
    createdAt: "2026-08-06T12:00:00.000Z",
    ...overrides,
  };
}

/** Records the filter each request carried. */
function skillsReturning(byFilter: Record<string, object[]>, seen: string[] = []) {
  server.use(
    http.get(`${API}/skills`, ({ request }) => {
      const url = new URL(request.url);
      const key = url.searchParams.get("overconfidentOnly")
        ? "overconfident"
        : (url.searchParams.get("band") ?? "");
      seen.push(key);
      return HttpResponse.json({ skills: byFilter[key] ?? byFilter[""] ?? [] });
    }),
  );
  return seen;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("an unproven skill", () => {
  it("says there is no evidence rather than showing a zero", async () => {
    // "No evidence" and "evidence that you score zero" are different claims, and a 0% bar states the
    // second.
    skillsReturning({ "": [skill()] });

    renderWithProviders(<SkillsRoute />);
    expect(await screen.findByText("No evidence yet")).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("explains that it is not a score of zero", async () => {
    skillsReturning({ "": [skill()] });
    renderWithProviders(<SkillsRoute />);
    expect(await screen.findByText(/Not a score of zero/)).toBeVisible();
  });

  it("shows no band", async () => {
    // The band is derived from the score, so an unproven skill has none — `aware` would be a claim.
    skillsReturning({ "": [skill()] });

    renderWithProviders(<SkillsRoute />);
    const card = await screen.findByRole("article", { name: "Rust ownership" });
    for (const band of ["Aware", "Assisted", "Working", "Fluent", "Teaching"]) {
      expect(within(card).queryByText(band)).not.toBeInTheDocument();
    }
  });
});

describe("a scored skill", () => {
  it("draws the gauge at the decayed score the server reported", async () => {
    skillsReturning({
      "": [skill({ score: 62, scoreStdDev: 18, band: "working", feather: "soft" })],
    });

    renderWithProviders(<SkillsRoute />);
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");
  });

  it("shows the confidence interval, because a bare number is a lie (FR-S3)", async () => {
    skillsReturning({ "": [skill({ score: 62, scoreStdDev: 18, band: "working" })] });

    renderWithProviders(<SkillsRoute />);
    expect(await screen.findByText(/± 18/)).toBeVisible();
  });

  it("feathers the gauge by how stale the evidence is", async () => {
    // Uncertainty as soft edges rather than a footnote (§9.1), so a vague score cannot be read as a
    // precise one at a glance.
    skillsReturning({ "": [skill({ score: 62, band: "working", feather: "vague" })] });

    renderWithProviders(<SkillsRoute />);
    const bar = await screen.findByRole("progressbar");
    expect(bar.firstElementChild).toHaveAttribute("data-feather", "vague");
  });

  it("names the band from the glossary", async () => {
    skillsReturning({ "": [skill({ score: 62, band: "working" })] });

    renderWithProviders(<SkillsRoute />);
    const card = await screen.findByRole("article", { name: "Rust ownership" });
    expect(within(card).getByText("Working")).toBeVisible();
  });
});

describe("the calibration gap (FR-S5)", () => {
  it("states overconfidence plainly, with no softening", async () => {
    // The requirements call this the highest-value thing the app can show, so it is a sentence rather
    // than a number in a corner.
    skillsReturning({
      "": [
        skill({
          score: 50,
          band: "working",
          perceivedLevel: 90,
          perceivedBand: "fluent",
          calibrationGap: 40,
          calibrationVerdict: "overconfident",
          calibrationMissing: null,
          bandGap: 1,
        }),
      ],
    });

    renderWithProviders(<SkillsRoute />);
    expect(await screen.findByText("You rate this 40 points above the evidence.")).toBeVisible();
  });

  it("says which bands disagree, which is what people act on", async () => {
    skillsReturning({
      "": [
        skill({
          score: 30,
          band: "assisted",
          perceivedLevel: 75,
          perceivedBand: "fluent",
          calibrationGap: 45,
          calibrationVerdict: "overconfident",
          calibrationMissing: null,
          bandGap: 2,
        }),
      ],
    });

    renderWithProviders(<SkillsRoute />);
    expect(await screen.findByText("You say Fluent; the evidence says Assisted.")).toBeVisible();
  });

  it("names underconfidence rather than folding it into 'miscalibrated'", async () => {
    // Someone who knows more than they think needs different advice — do the harder thing.
    skillsReturning({
      "": [
        skill({
          score: 75,
          band: "fluent",
          perceivedLevel: 40,
          perceivedBand: "assisted",
          calibrationGap: -35,
          calibrationVerdict: "underconfident",
          calibrationMissing: null,
          bandGap: -2,
        }),
      ],
    });

    renderWithProviders(<SkillsRoute />);
    expect(await screen.findByText("You rate this 35 points below the evidence.")).toBeVisible();
  });

  it("does not call a rated-but-undemonstrated skill calibrated", async () => {
    // The single most misleading thing this screen could do. It is the most interesting row in the
    // table, and "your rating matches the evidence" would bury it.
    skillsReturning({
      "": [skill({ perceivedLevel: 90, perceivedBand: "fluent", calibrationMissing: "score" })],
    });

    renderWithProviders(<SkillsRoute />);
    expect(await screen.findByText(/Rated, but never demonstrated/)).toBeVisible();
    expect(screen.queryByText("Your rating matches the evidence.")).not.toBeInTheDocument();
  });

  it("invites a rating when there is a score but no rating", async () => {
    skillsReturning({
      "": [skill({ score: 60, band: "working", calibrationMissing: "self_rating" })],
    });

    renderWithProviders(<SkillsRoute />);
    expect(await screen.findByText(/whether you were right/)).toBeVisible();
  });

  it("does not repeat the band sentence when both land in the same band", async () => {
    // The points gap can be nonzero while the bands agree — 51 and 69 are both Working, and the bands
    // exist because that distinction rarely matters.
    skillsReturning({
      "": [
        skill({
          score: 51,
          band: "working",
          perceivedLevel: 69,
          perceivedBand: "working",
          calibrationGap: 18,
          calibrationVerdict: "overconfident",
          calibrationMissing: null,
          bandGap: 0,
        }),
      ],
    });

    renderWithProviders(<SkillsRoute />);
    await screen.findByText("You rate this 18 points above the evidence.");
    expect(screen.queryByText(/the evidence says/)).not.toBeInTheDocument();
  });
});

describe("rating yourself (FR-S5)", () => {
  it("sends the rating to its own endpoint", async () => {
    skillsReturning({ "": [skill()] });
    const sent = vi.fn();
    server.use(
      http.patch(`${API}/skills/:id/rating`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(skill({ perceivedLevel: 70 }));
      }),
    );

    renderWithProviders(<SkillsRoute />);
    await userEvent.type(await screen.findByLabelText("Your rating"), "70");
    await userEvent.click(screen.getByRole("button", { name: "Save rating" }));

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ perceivedLevel: 70 }));
  });

  it("says out loud that a rating is not evidence", async () => {
    // Someone who thinks this is the score will treat a high rating as an achievement, which is the
    // confusion the whole feature is arranged against.
    skillsReturning({ "": [skill()] });

    renderWithProviders(<SkillsRoute />);
    expect(await screen.findByText(/never used as evidence/)).toBeVisible();
  });

  it("will not send a rating off the scale", async () => {
    skillsReturning({ "": [skill()] });
    const sent = vi.fn();
    server.use(
      http.patch(`${API}/skills/:id/rating`, () => {
        sent();
        return HttpResponse.json(skill());
      }),
    );

    renderWithProviders(<SkillsRoute />);
    await userEvent.type(await screen.findByLabelText("Your rating"), "150");
    expect(screen.getByRole("button", { name: "Save rating" })).toBeDisabled();
    expect(sent).not.toHaveBeenCalled();
  });

  it("has no control that sets a score", async () => {
    // The invariant the feature protects, asserted on the rendered surface.
    skillsReturning({ "": [skill({ score: 50, band: "working" })] });

    renderWithProviders(<SkillsRoute />);
    await screen.findByText("Rust ownership");
    // The gauge is labelled "Evidence" but is a progressbar, not a control — there is no input that
    // could write one.
    expect(screen.queryByRole("spinbutton", { name: /Evidence/ })).not.toBeInTheDocument();
    // The only number field on a card is the rating.
    expect(screen.getAllByRole("spinbutton")).toHaveLength(1);
  });
});

describe("prerequisites (FR-S1)", () => {
  function twoSkills() {
    const borrowing = skill({ name: "Borrowing" });
    const lifetimes = skill({ name: "Lifetimes" });
    return { borrowing, lifetimes };
  }

  it("lists a skill's prerequisites by name", async () => {
    const { borrowing, lifetimes } = twoSkills();
    skillsReturning({
      "": [borrowing, { ...lifetimes, prerequisiteIds: [borrowing.id] }],
    });

    renderWithProviders(<SkillsRoute />);
    const card = await screen.findByRole("article", { name: "Lifetimes" });
    expect(within(card).getByText("Borrowing")).toBeVisible();
  });

  it("adds one", async () => {
    const { borrowing, lifetimes } = twoSkills();
    skillsReturning({ "": [borrowing, lifetimes] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/skills/:id/prerequisites`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(lifetimes);
      }),
    );

    renderWithProviders(<SkillsRoute />);
    const card = await screen.findByRole("article", { name: "Lifetimes" });
    await userEvent.click(within(card).getByRole("button", { name: "Add a prerequisite" }));
    await userEvent.selectOptions(
      within(card).getByLabelText("Which skill comes first?"),
      borrowing.id,
    );
    await userEvent.click(within(card).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ prereqId: borrowing.id }));
  });

  it("does not offer a skill that already depends on this one", async () => {
    // The server refuses it with a 409 either way, so offering the choice would waste a round trip to
    // be told no. `allPrerequisites` decides it in both places, so they cannot disagree.
    const { borrowing, lifetimes } = twoSkills();
    const withEdge = { ...lifetimes, prerequisiteIds: [borrowing.id] };
    skillsReturning({ "": [borrowing, withEdge] });

    renderWithProviders(<SkillsRoute />);
    const card = await screen.findByRole("article", { name: "Borrowing" });
    // Borrowing has nothing it could require: Lifetimes depends on it, and itself is excluded.
    expect(within(card).getByRole("button", { name: "Add a prerequisite" })).toBeDisabled();
  });

  it("says why a skill is missing from the picker", async () => {
    // A name absent from a list with no explanation reads as a bug.
    const a = skill({ name: "A" });
    const b = skill({ name: "B" });
    const c = skill({ name: "C" });
    skillsReturning({ "": [a, { ...b, prerequisiteIds: [a.id] }, c] });

    renderWithProviders(<SkillsRoute />);
    const card = await screen.findByRole("article", { name: "A" });
    await userEvent.click(within(card).getByRole("button", { name: "Add a prerequisite" }));

    // B is excluded because it depends on A; C is offered.
    expect(within(card).getByText(/Not shown/)).toBeVisible();
    const picker = within(card).getByLabelText("Which skill comes first?");
    expect(within(picker).getByRole("option", { name: "C" })).toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: "B" })).not.toBeInTheDocument();
  });

  it("removes one", async () => {
    const { borrowing, lifetimes } = twoSkills();
    skillsReturning({ "": [borrowing, { ...lifetimes, prerequisiteIds: [borrowing.id] }] });
    const deleted = vi.fn();
    server.use(
      http.delete(`${API}/skills/:id/prerequisites/:prereqId`, ({ params }) => {
        deleted(params["prereqId"]);
        return HttpResponse.json(lifetimes);
      }),
    );

    renderWithProviders(<SkillsRoute />);
    const card = await screen.findByRole("article", { name: "Lifetimes" });
    await userEvent.click(within(card).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleted).toHaveBeenCalledWith(borrowing.id));
  });

  it("surfaces a refused cycle rather than swallowing it", async () => {
    const { borrowing, lifetimes } = twoSkills();
    skillsReturning({ "": [borrowing, lifetimes] });
    server.use(
      http.post(`${API}/skills/:id/prerequisites`, () =>
        problemResponse(
          409,
          "prerequisite-cycle",
          "That would make the two skills depend on each other.",
        ),
      ),
    );

    renderWithProviders(<SkillsRoute />);
    const card = await screen.findByRole("article", { name: "Lifetimes" });
    await userEvent.click(within(card).getByRole("button", { name: "Add a prerequisite" }));
    await userEvent.click(within(card).getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("depend on each other");
  });
});

describe("adding a skill", () => {
  it("takes a name alone", async () => {
    skillsReturning({ "": [] });
    const sent = vi.fn();
    server.use(
      http.post(`${API}/skills`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(skill(), { status: 201 });
      }),
    );

    renderWithProviders(<SkillsRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a skill" }));
    await userEvent.type(screen.getByLabelText("What skill?"), "Rust ownership");
    await userEvent.click(screen.getByRole("button", { name: "Add skill" }));

    await waitFor(() => expect(sent).toHaveBeenCalled());
    const body = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.name).toBe("Rust ownership");
    // No score, ever.
    expect(body).not.toHaveProperty("score");
    expect(body).not.toHaveProperty("band");
  });

  it("keeps the typing when the name is taken", async () => {
    skillsReturning({ "": [] });
    server.use(
      http.post(`${API}/skills`, () =>
        problemResponse(409, "skill-name-taken", "You already have a skill with that name."),
      ),
    );

    renderWithProviders(<SkillsRoute />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a skill" }));
    const box = screen.getByLabelText("What skill?");
    await userEvent.type(box, "Rust");
    await userEvent.click(screen.getByRole("button", { name: "Add skill" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already have a skill");
    expect(box).toHaveValue("Rust");
  });

  it("will not submit without a name", async () => {
    skillsReturning({ "": [] });
    renderWithProviders(<SkillsRoute />);

    await userEvent.click(await screen.findByRole("button", { name: "Add a skill" }));
    expect(screen.getByRole("button", { name: "Add skill" })).toBeDisabled();
  });
});

describe("filtering", () => {
  it("filters to the overconfident skills on the server", async () => {
    const seen = skillsReturning({ "": [skill()], overconfident: [] });

    renderWithProviders(<SkillsRoute />);
    await screen.findByText("Rust ownership");

    await userEvent.selectOptions(screen.getByLabelText("Show"), "overconfident");
    await waitFor(() => expect(seen).toContain("overconfident"));
  });

  it("explains an empty overconfidence list rather than looking broken", async () => {
    // In M1 it is empty for everyone, because scores need evidence and evidence lands in M2. Saying
    // "nothing in this list" would read as "you are well calibrated", which nothing has established.
    skillsReturning({ "": [skill()], overconfident: [] });

    renderWithProviders(<SkillsRoute />);
    await screen.findByText("Rust ownership");
    await userEvent.selectOptions(screen.getByLabelText("Show"), "overconfident");

    expect(await screen.findByText(/once there is evidence to compare/)).toBeVisible();
  });

  it("filters by band, using the glossary's words", async () => {
    const seen = skillsReturning({ "": [skill()], working: [] });

    renderWithProviders(<SkillsRoute />);
    await screen.findByText("Rust ownership");

    const filter = screen.getByLabelText("Show");
    expect(within(filter).getByRole("option", { name: "Working" })).toBeInTheDocument();

    await userEvent.selectOptions(filter, "working");
    await waitFor(() => expect(seen).toContain("working"));
  });

  it("invites a first skill when there are none", async () => {
    skillsReturning({ "": [] });
    renderWithProviders(<SkillsRoute />);
    expect(await screen.findByText(/what you have shown, not what you have read/)).toBeVisible();
  });
});

describe("pt-BR", () => {
  it("renders the screen and the band vocabulary in Portuguese", async () => {
    skillsReturning({
      "": [
        skill({
          score: 50,
          band: "working",
          perceivedLevel: 90,
          perceivedBand: "fluent",
          calibrationGap: 40,
          calibrationVerdict: "overconfident",
          calibrationMissing: null,
          bandGap: 1,
        }),
      ],
    });

    renderWithProviders(<SkillsRoute />, { locale: "pt-BR" });

    const card = await screen.findByRole("article", { name: "Rust ownership" });
    expect(screen.getByText("Habilidades")).toBeVisible();
    expect(within(card).getByText("Praticando")).toBeVisible();
    expect(within(card).getByText("Você se avalia 40 pontos acima da evidência.")).toBeVisible();
  });
});
