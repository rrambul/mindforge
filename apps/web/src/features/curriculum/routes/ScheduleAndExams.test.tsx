import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { curriculumLesson, curriculumModule, curriculumResponse } from "../../../test/fixtures.js";
import { API, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import type { Curriculum, CurriculumModule } from "../api/use-curriculum.js";
import { CurriculumRoute } from "./CurriculumRoute.js";

/**
 * Exams, deadlines and the schedule on the curriculum screen (FR-E6, FR-E7,
 * FR-U2–U5).
 *
 * Every date and every exam state was derived by the server; these tests are about
 * what the screen must say about them, and mostly about what it must not: an
 * unwritten exam is not a failed one, a projected date is never shown as a due one,
 * and a moved deadline never hides that it moved.
 */

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const MISSION = "11111111-1111-4111-8111-111111111111";
const MODULE = "22222222-2222-4222-8222-222222222222";
const EXAM = "33333333-3333-4333-8333-333333333333";
const LESSON = "44444444-4444-4444-8444-444444444444";

function module(over: Partial<CurriculumModule> = {}): CurriculumModule {
  return curriculumModule({
    id: MODULE,
    name: "Ownership",
    progress: { completed: 1, total: 3 },
    outcomes: { understood: 1, shaky: 0, lost: 0, unrecorded: 0 },
    ...over,
  });
}

function returns(over: Partial<Curriculum> & { modules: readonly CurriculumModule[] }) {
  server.use(
    http.get(`${API}/missions/${MISSION}/curriculum`, () =>
      HttpResponse.json(curriculumResponse({ missionId: MISSION, today: "2026-10-01", ...over })),
    ),
  );
}

function render() {
  renderWithProviders(
    <CurriculumRoute
      missionId={MISSION}
      topic="Rust"
      targetLink={(target) => <a href={`/lessons/${target.id}`}>{target.title}</a>}
    />,
  );
}

describe("a module's exam", () => {
  it("says the exam comes once the lessons are done, before they are", async () => {
    returns({ modules: [module()] });
    render();

    expect(
      await screen.findByText("Exam: written once every lesson here is done."),
    ).toBeInTheDocument();
  });

  it("says an unwritten exam is not written yet — never that it was failed", async () => {
    returns({ modules: [module({ progress: { completed: 3, total: 3 } })] });
    render();

    expect(
      await screen.findByText("Exam: not written yet. Ask for the next thing and it will be."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 of/u)).not.toBeInTheDocument();
  });

  it("links the exam, says how far through it you are, and names what to revisit", async () => {
    returns({
      modules: [
        module({
          progress: { completed: 3, total: 3 },
          exam: {
            lessonId: EXAM,
            title: "Exam: Ownership",
            result: {
              total: 4,
              passedCount: 2,
              checkedPasses: 1,
              selfReportedPasses: 1,
              attempted: true,
              passed: false,
              passedAt: null,
              revisit: [{ id: LESSON, title: "Borrowing" }],
            },
          },
        }),
      ],
    });
    render();

    expect(await screen.findByText("Exam: 2 of 4 items passed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Exam: Ownership" })).toHaveAttribute(
      "href",
      `/lessons/${EXAM}`,
    );
    expect(screen.getByText("1 of those passes is self-reported.")).toBeInTheDocument();
    expect(screen.getByText("To revisit:")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Borrowing" })).toBeInTheDocument();
  });

  it("says an exam not sat yet is not sat yet", async () => {
    returns({
      modules: [
        module({
          progress: { completed: 3, total: 3 },
          exam: {
            lessonId: EXAM,
            title: "Exam: Ownership",
            result: {
              total: 3,
              passedCount: 0,
              checkedPasses: 0,
              selfReportedPasses: 0,
              attempted: false,
              passed: false,
              passedAt: null,
              revisit: [{ id: LESSON, title: "Borrowing" }],
            },
          },
        }),
      ],
    });
    render();

    expect(await screen.findByText("Exam: 3 items, not sat yet.")).toBeInTheDocument();
    // Nothing to revisit before anything was tried.
    expect(screen.queryByText("To revisit:")).not.toBeInTheDocument();
  });

  it("does not say an exam is due on a module the plan calls done with lessons unread", async () => {
    // `done` in CURRICULUM.md with two lessons unread: no exam exists or will be
    // queued (FR-E3 needs every lesson done), so "exam to pass" would be invented.
    returns({ modules: [module({ status: "done", progress: { completed: 1, total: 3 } })] });
    render();

    expect(await screen.findByText("Open")).toBeInTheDocument();
    expect(screen.queryByText("Exam to pass")).not.toBeInTheDocument();
    expect(screen.queryByText("Finished")).not.toBeInTheDocument();
  });

  it("does not call a module finished while its exam is not passed (FR-E7)", async () => {
    returns({ modules: [module({ status: "done", progress: { completed: 3, total: 3 } })] });
    render();

    expect(await screen.findByText("Exam to pass")).toBeInTheDocument();
    expect(screen.queryByText("Finished")).not.toBeInTheDocument();
  });
});

describe("a module's week (FR-B3–B5)", () => {
  const WEEK = { index: 2, startsOn: "2026-10-04", examOn: "2026-10-09", endsOn: "2026-10-10" };

  it("shows the week's dates and how far behind it is, once and plainly", async () => {
    returns({
      modules: [
        module({
          week: {
            ...WEEK,
            standing: {
              kind: "in-progress",
              total: 5,
              completed: 1,
              behind: 2,
              dueToday: 1,
              examToday: false,
            },
          },
        }),
      ],
    });
    render();

    expect(await screen.findByText(/^Week 2 · .+ · exam on /u)).toBeInTheDocument();
    expect(
      screen.getByText("2 lessons behind: 1 of 5 done. Today's lesson is still to do."),
    ).toBeInTheDocument();
  });

  it("says a week with nothing planned is not planned — never on track", async () => {
    returns({ modules: [module({ week: { ...WEEK, standing: { kind: "not-planned" } } })] });
    render();

    expect(
      await screen.findByText("No lessons are planned for this week yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/On track/u)).not.toBeInTheDocument();
  });

  it("says on track, not a celebration, when nothing due is unfinished", async () => {
    returns({
      modules: [
        module({
          week: {
            ...WEEK,
            standing: {
              kind: "in-progress",
              total: 4,
              completed: 3,
              behind: 0,
              dueToday: 0,
              examToday: false,
            },
          },
        }),
      ],
    });
    render();

    // Out of the module's own four lessons, not an assumed five.
    expect(await screen.findByText("On track: 3 of 4 lessons done.")).toBeInTheDocument();
  });

  it("says a week that ended unfinished ended, with what is left", async () => {
    returns({
      modules: [
        module({
          week: { ...WEEK, standing: { kind: "overdue", daysOver: 3, lessonsLeft: 2, total: 5 } },
        }),
      ],
    });
    render();

    expect(
      await screen.findByText("This week ended 3 days ago with 2 lessons left."),
    ).toBeInTheDocument();
  });

  it("says a late finish once, with how late", async () => {
    returns({
      modules: [
        module({
          progress: { completed: 3, total: 3 },
          finishedAt: "2026-10-12T12:00:00.000Z",
          projection: { status: "finished" },
          week: { ...WEEK, standing: { kind: "finished", daysLate: 3 } },
        }),
      ],
    });
    render();

    expect(await screen.findByText("Finished 3 days after its exam day.")).toBeInTheDocument();
  });

  it("puts the pace projection beside the week as information, not a new date", async () => {
    returns({
      modules: [
        module({
          week: { ...WEEK, standing: { kind: "upcoming", startsInDays: 2 } },
          projection: {
            status: "projected",
            units: 3,
            minutes: 90,
            startDay: "2026-10-04",
            examDay: "2026-10-15",
          },
        }),
      ],
    });
    render();

    expect(await screen.findByText("Starts in 2 days.")).toBeInTheDocument();
    expect(screen.getByText(/^At your pace, the exam lands on /u)).toBeInTheDocument();
  });

  it("shows each lesson's day", async () => {
    returns({
      modules: [
        module({
          week: { ...WEEK, standing: { kind: "upcoming", startsInDays: 2 } },
          lessons: [curriculumLesson({ title: "Handlers and events", dueOn: "2026-10-05" })],
        }),
      ],
    });
    render();

    const line = (await screen.findByText("Handlers and events")).closest("li")!;
    expect(within(line).getByText(/^Mon, Oct 5 · /u)).toBeInTheDocument();
  });
});

describe("the overview", () => {
  it("lists the weeks with where each stands, for a mission planned in weeks", async () => {
    returns({
      calendar: { weeks: 2, startsOn: "2026-09-27", endsOn: "2026-10-10" },
      modules: [
        module({
          week: {
            index: 1,
            startsOn: "2026-09-27",
            examOn: "2026-10-02",
            endsOn: "2026-10-03",
            standing: {
              kind: "in-progress",
              total: 5,
              completed: 3,
              behind: 2,
              dueToday: 0,
              examToday: false,
            },
          },
        }),
        module({
          id: "55555555-5555-4555-8555-555555555555",
          name: "Traits",
          week: {
            index: 2,
            startsOn: "2026-10-04",
            examOn: "2026-10-09",
            endsOn: "2026-10-10",
            standing: { kind: "upcoming", startsInDays: 3 },
          },
        }),
      ],
    });
    render();

    const weeks = within(await screen.findByRole("region", { name: "Weeks" }));
    expect(
      weeks.getByText(/^2 weeks, .+ Lessons on days 1–5, the exam on day 6\.$/u),
    ).toBeInTheDocument();
    expect(weeks.getByText("Week 1 · Ownership")).toBeInTheDocument();
    expect(weeks.getByText("2 lessons behind")).toBeInTheDocument();
    expect(weeks.getByText(/^starts /u)).toBeInTheDocument();
  });

  it("labels projected exam days for a mission from before weeks", async () => {
    returns({
      pace: {
        status: "known",
        minutesPerLesson: 30,
        timedLessons: 4,
        minutesPerDay: 12.4,
        windowDays: 28,
      },
      modules: [
        module({
          projection: {
            status: "projected",
            units: 4,
            minutes: 120,
            startDay: "2026-10-09",
            examDay: "2026-10-19",
          },
        }),
      ],
    });
    render();

    const schedule = within(await screen.findByRole("region", { name: "Schedule" }));
    expect(schedule.getByText(/^exam projected /u)).toBeInTheDocument();
    expect(
      schedule.getByText(
        /30 minutes a lesson \(the median of 4 timed lessons\) and 12 minutes a day/u,
      ),
    ).toBeInTheDocument();
  });

  it("shows a slow pace as the small number it is, never as zero", async () => {
    returns({
      pace: {
        status: "known",
        minutesPerLesson: 30,
        timedLessons: 3,
        minutesPerDay: 13 / 28,
        windowDays: 28,
      },
      modules: [module()],
    });
    render();

    const schedule = within(await screen.findByRole("region", { name: "Schedule" }));
    expect(schedule.getByText(/and 0\.46 minutes a day/u)).toBeInTheDocument();
  });

  it("says what is missing instead of projecting from nothing", async () => {
    returns({
      pace: { status: "unknown", missing: ["timed-lessons", "recent-time"], timedLessons: 1 },
      modules: [module()],
    });
    render();

    const schedule = within(await screen.findByRole("region", { name: "Schedule" }));
    expect(
      schedule.getByText(/No projections yet\. .+and there is 1\. They need some focus time/u),
    ).toBeInTheDocument();
    expect(schedule.getByText("no date yet")).toBeInTheDocument();
  });
});
