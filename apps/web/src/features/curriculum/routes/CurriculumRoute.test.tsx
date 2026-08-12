import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import type { Curriculum, CurriculumLesson, CurriculumModule } from "../api/use-curriculum.js";
import { CurriculumRoute } from "./CurriculumRoute.js";

/**
 * The curriculum screen (FR-K5).
 *
 * Every state on this screen is a claim about the learner's own plan, so the tests
 * are mostly about the claims it must *not* make: no percentage over a plan that
 * gets revised, no zero for a module nobody has planned, no lock without a reason,
 * no badge on a lesson nothing depends on.
 */

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const MISSION = "11111111-1111-4111-8111-111111111111";

function lesson(over: Partial<CurriculumLesson> = {}): CurriculumLesson {
  return {
    id: crypto.randomUUID(),
    slug: "query-plans",
    title: "Query plans",
    intent: "Read one aloud",
    status: "planned",
    difficulty: 2,
    depth: "working",
    completed: false,
    outcome: null,
    unblocked: true,
    blockedBy: [],
    dependentCount: 0,
    ...over,
  };
}

function module(over: Partial<CurriculumModule> = {}): CurriculumModule {
  return {
    id: crypto.randomUUID(),
    slug: "pg-basics",
    name: "Postgres basics",
    outcome: "Read a query plan",
    status: "active",
    prerequisites: [],
    progress: { completed: 0, total: 1 },
    outcomes: { understood: 0, shaky: 0, lost: 0, unrecorded: 0 },
    lessons: [lesson()],
    ...over,
  };
}

/**
 * `progress` defaults to absent rather than to a fraction, which is what the older
 * tests below want: they are about the modules, and a mission bar they never asked for
 * would put a second "2 of 7 lessons done" on the screen for their queries to match.
 * Its own behaviour is covered in "the mission's progress".
 */
function returns(curriculum: Partial<Curriculum> & { modules: readonly CurriculumModule[] }) {
  server.use(
    http.get(`${API}/missions/${MISSION}/curriculum`, () =>
      HttpResponse.json({ missionId: MISSION, nextLessonId: null, ...curriculum }),
    ),
  );
}

function render() {
  renderWithProviders(<CurriculumRoute missionId={MISSION} topic="Postgres RLS" />);
}

describe("the modules", () => {
  it("shows each module with what it is for and how far through it you are", async () => {
    returns({ modules: [module({ progress: { completed: 2, total: 7 } })] });
    render();

    expect(await screen.findByRole("heading", { name: "Postgres basics" })).toBeInTheDocument();
    expect(screen.getByText("Afterwards you can: Read a query plan")).toBeInTheDocument();
    expect(screen.getByText("2 of 7 lessons done")).toBeInTheDocument();
  });

  it("renders progress as a fraction and never as a percentage", async () => {
    // A percentage of a plan that gets revised reads as a measurement of the
    // learner. A fraction reads as what it is: a count against a plan that moves.
    returns({ modules: [module({ progress: { completed: 1, total: 3 } })] });
    render();

    await screen.findByText("1 of 3 lessons done");
    expect(screen.queryByText(/%/u)).not.toBeInTheDocument();
  });

  it("says a module has no plan rather than showing it as zero", async () => {
    // Non-negotiable 10: 0/0 drawn as a bar is a claim that something was measured.
    returns({ modules: [module({ progress: null, lessons: [] })] });
    render();

    expect(await screen.findByText("No lessons planned here yet.")).toBeInTheDocument();
    expect(screen.queryByText(/0 of 0/u)).not.toBeInTheDocument();
  });

  it("says the curriculum recorded no outcome rather than leaving a gap", async () => {
    returns({ modules: [module({ outcome: null })] });
    render();

    expect(
      await screen.findByText("The curriculum didn't record an outcome for this module."),
    ).toBeInTheDocument();
  });

  it("names what a module is built on", async () => {
    returns({ modules: [module({ prerequisites: ["Postgres basics", "SQL"] })] });
    render();

    expect(await screen.findByText("Built on Postgres basics, SQL")).toBeInTheDocument();
  });
});

describe("the lessons", () => {
  it("shows difficulty and depth, and says when the plan did not record them", async () => {
    returns({
      modules: [
        module({
          lessons: [
            lesson({ slug: "a", title: "Rated", difficulty: 4, depth: "deep_dive" }),
            lesson({ slug: "b", title: "Unrated", difficulty: null, depth: null }),
          ],
        }),
      ],
    });
    render();

    const rated = (await screen.findByText("Rated")).closest("li")!;
    expect(within(rated).getByText(/Difficulty 4 of 5 · Deep dive/u)).toBeInTheDocument();

    const unrated = screen.getByText("Unrated").closest("li")!;
    expect(
      within(unrated).getByText(/Difficulty not recorded · Depth not recorded/u),
    ).toBeInTheDocument();
  });

  it("says what a locked lesson is waiting for", async () => {
    // A padlock with no reason is a dead end; the prerequisite's title is a route.
    returns({
      modules: [module({ lessons: [lesson({ unblocked: false, blockedBy: ["Query plans"] })] })],
    });
    render();

    expect(await screen.findByText("Waiting on Query plans")).toBeInTheDocument();
  });

  it("badges a lesson other lessons depend on, and counts them", async () => {
    returns({ modules: [module({ lessons: [lesson({ dependentCount: 3 })] })] });
    render();

    expect(await screen.findByText("3 lessons build on this")).toBeInTheDocument();
  });

  it("does not badge a lesson nothing depends on", async () => {
    // Zero dependents is not "not fundamental yet" — it is a lesson nothing is
    // built on, which is a fine thing to be.
    returns({ modules: [module({ lessons: [lesson({ dependentCount: 0 })] })] });
    render();

    await screen.findByText("Query plans");
    expect(screen.queryByText(/build[s]? on this/u)).not.toBeInTheDocument();
  });

  it("marks the one lesson the plan would have you do next", async () => {
    const next = lesson({ slug: "next", title: "Next up" });
    returns({ modules: [module({ lessons: [lesson(), next] })], nextLessonId: next.id });
    render();

    const line = (await screen.findByText("Next up")).closest("li")!;
    expect(within(line).getByText("Next")).toBeInTheDocument();
  });

  it("shows a finished lesson's outcome rather than only that it is done", async () => {
    returns({
      modules: [
        module({ lessons: [lesson({ completed: true, status: "generated", outcome: "shaky" })] }),
      ],
    });
    render();

    expect(await screen.findByText("Shaky")).toBeInTheDocument();
  });

  it("says a planned lesson has not been written yet", async () => {
    // The difference between "you have not read it" and "it does not exist" is
    // the difference between opening it and pressing teach.
    returns({ modules: [module({ lessons: [lesson({ status: "planned" })] })] });
    render();

    expect(await screen.findByText(/not written yet/u)).toBeInTheDocument();
  });
});

describe("a mission with no curriculum", () => {
  it("offers the action that plans one, not the one that teaches a lesson", async () => {
    // §5.3 says an empty state names one action; honesty says it names the one
    // that works. Both slots post to the same endpoint — the API picks the agent
    // from the absence of modules (FR-K1) — so the difference the learner sees is
    // the wording, and showing "teach me the next thing" on a mission with no plan
    // would describe the wrong run.
    //
    // This test used to assert the opposite: that the empty state named a terminal
    // command and deliberately withheld a button, because nothing in the app could
    // dispatch a curriculum run. It can now.
    returns({ modules: [] });
    renderWithProviders(
      <CurriculumRoute
        missionId={MISSION}
        teach={<button type="button">Teach me the next thing</button>}
        plan={<button type="button">Plan the curriculum</button>}
      />,
    );

    expect(await screen.findByText("No curriculum yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan the curriculum" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Teach me the next thing" }),
    ).not.toBeInTheDocument();
  });

  it("says the plan comes without lessons, because that is the next question", async () => {
    returns({ modules: [] });
    renderWithProviders(
      <CurriculumRoute missionId={MISSION} plan={<button type="button">Plan</button>} />,
    );

    expect(await screen.findByText(/writes the plan and no lessons/u)).toBeInTheDocument();
  });
});

describe("when the read fails", () => {
  it("shows what went wrong and offers to try again", async () => {
    server.use(
      http.get(`${API}/missions/${MISSION}/curriculum`, () =>
        problemResponse(404, "mission_not_found", "That mission isn't here."),
      ),
    );
    render();

    expect(await screen.findByText("That mission isn't here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("in Portuguese", () => {
  it("renders the plural rules of the language, not English's", async () => {
    returns({ modules: [module({ lessons: [lesson({ dependentCount: 1 })] })] });
    renderWithProviders(<CurriculumRoute missionId={MISSION} />, { locale: "pt-BR" });

    expect(await screen.findByText("1 lição se apoia nesta")).toBeInTheDocument();
    expect(screen.getByText("0 de 1 lições concluídas")).toBeInTheDocument();
  });
});

/**
 * How a module's finished lessons landed (FR-P4).
 *
 * The wrong answers this rules out are both about softening: a distribution that
 * hid the shaky ones, and one that dropped the completions made before an outcome
 * could be recorded — which would show three outcomes against a fraction saying
 * five, with nothing on screen to explain the gap.
 */
describe("the outcome distribution", () => {
  it("names each outcome the module actually has", () => {
    returns({
      modules: [
        module({
          progress: { completed: 4, total: 6 },
          outcomes: { understood: 2, shaky: 1, lost: 1, unrecorded: 0 },
        }),
      ],
    });
    render();

    return screen.findByText("2 understood · 1 shaky · 1 lost").then((line) => {
      expect(line).toBeInTheDocument();
    });
  });

  it("counts a completion with no outcome rather than dropping it", async () => {
    returns({
      modules: [
        module({
          progress: { completed: 3, total: 6 },
          outcomes: { understood: 2, shaky: 0, lost: 0, unrecorded: 1 },
        }),
      ],
    });
    render();

    expect(await screen.findByText(/1 finished with no outcome/u)).toBeInTheDocument();
  });

  it("says nothing at all for a module with nothing finished", async () => {
    // Four named zeros under an unstarted module is furniture: the fraction above
    // already says "0 of 1 lessons done".
    returns({ modules: [module()] });
    render();

    await screen.findByText("0 of 1 lessons done");
    expect(screen.queryByText(/understood/u)).not.toBeInTheDocument();
  });

  it("says nothing for a module with no plan, where there is no denominator either", async () => {
    returns({ modules: [module({ progress: null, outcomes: null, lessons: [] })] });
    render();

    expect(await screen.findByText("No lessons planned here yet.")).toBeInTheDocument();
  });
});

describe("the mission's progress", () => {
  it("draws one bar for the whole mission, labelled and valued as a fraction", async () => {
    returns({
      progress: { completed: 12, total: 68, modulesNotPlanned: 0 },
      modules: [module({ progress: { completed: 2, total: 7 } })],
    });
    render();

    const bar = await screen.findByRole("progressbar", { name: "Progress through this mission" });

    // `aria-valuetext` carries the fraction so a screen reader hears what the screen
    // says. Without it the role announces a percentage nothing on the page states.
    expect(bar).toHaveAttribute("aria-valuetext", "12 of 68 lessons done");
    expect(bar).toHaveAttribute("aria-valuenow", "12");
    expect(bar).toHaveAttribute("aria-valuemax", "68");
  });

  it("never renders a percentage, for the mission or for a module", async () => {
    // The rule the module fraction has carried since M4, now with a bar beside it:
    // a percentage of a plan that gets revised reads as a measurement of the learner.
    returns({
      progress: { completed: 1, total: 3, modulesNotPlanned: 0 },
      modules: [module({ progress: { completed: 1, total: 3 } })],
    });
    render();

    await screen.findByRole("progressbar", { name: "Progress through this mission" });
    expect(screen.queryByText(/%/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/33/u)).not.toBeInTheDocument();
  });

  it("says how many modules the fraction could not see", async () => {
    // A bar over eight of fourteen modules is a measurement of part of the mission.
    // Rendering it without this line would present it as a measurement of all of it.
    returns({
      progress: { completed: 4, total: 20, modulesNotPlanned: 6 },
      modules: [module()],
    });
    render();

    expect(await screen.findByText(/6 modules have no lessons planned yet/u)).toBeInTheDocument();
  });

  it("stays quiet about unplanned modules when there are none", async () => {
    returns({
      progress: { completed: 4, total: 20, modulesNotPlanned: 0 },
      modules: [module()],
    });
    render();

    await screen.findByRole("progressbar", { name: "Progress through this mission" });
    expect(screen.queryByText(/no lessons planned yet/u)).not.toBeInTheDocument();
  });

  it("draws no bar at all when nothing is planned, rather than an empty one", async () => {
    // Non-negotiable 10, one level up from `moduleProgress`. An empty track is a claim
    // that something was measured and came out at zero.
    returns({ progress: null, modules: [module({ progress: null, lessons: [] })] });
    render();

    await screen.findByText("No lessons planned here yet.");
    expect(
      screen.queryByRole("progressbar", { name: "Progress through this mission" }),
    ).not.toBeInTheDocument();
  });

  it("renders the rest of the screen when the field is missing entirely", async () => {
    // A body from a server that does not send it yet. The modules carry their own
    // fractions and are what the screen is for — losing the bar is acceptable, losing
    // the page is not.
    returns({ modules: [module({ progress: { completed: 2, total: 7 } })] });
    render();

    expect(await screen.findByRole("heading", { name: "Postgres basics" })).toBeInTheDocument();
    expect(screen.getByText("2 of 7 lessons done")).toBeInTheDocument();
  });
});
