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
    lessons: [lesson()],
    ...over,
  };
}

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
  it("names the one action — which is a terminal command, not a button", async () => {
    // §5.3 says an empty state names one action; honesty says it names the one
    // that works. Nothing in the app dispatches a curriculum run today, and the
    // teach button queues a *lesson* — the `teach` skill is told CURRICULUM.md is
    // an input it must never write. A button here would not do what the sentence
    // above it promises.
    returns({ modules: [] });
    renderWithProviders(
      <CurriculumRoute missionId={MISSION} teach={<button type="button">Teach me</button>} />,
    );

    expect(await screen.findByText("No curriculum yet")).toBeInTheDocument();
    expect(screen.getByText("/curriculum")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Teach me" })).not.toBeInTheDocument();
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
