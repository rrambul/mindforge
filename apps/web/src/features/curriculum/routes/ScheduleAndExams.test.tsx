import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { curriculumModule, curriculumResponse } from "../../../test/fixtures.js";
import { API, problemResponse, server } from "../../../test/msw.js";
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

describe("a deadline", () => {
  it("prompts the module you are in, prefilled with the proposal, and commits in one tap", async () => {
    let sent: unknown = null;
    server.use(
      http.put(`${API}/missions/${MISSION}/modules/${MODULE}/deadline`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          curriculumResponse({
            missionId: MISSION,
            today: "2026-10-01",
            modules: [
              module({
                deadline: {
                  dueOn: "2026-10-09",
                  firstDueOn: "2026-10-09",
                  moves: 0,
                  status: { kind: "no-projection", daysLeft: 8 },
                },
              }),
            ],
            currentModuleId: MODULE,
          }),
        );
      }),
    );
    returns({
      modules: [module()],
      currentModuleId: MODULE,
      proposal: { moduleId: MODULE, dueOn: "2026-10-09" },
    });
    render();

    const field = await screen.findByLabelText("Deadline for Ownership");
    expect(field).toHaveValue("2026-10-09");
    expect(field).toHaveAttribute("min", "2026-10-01");
    expect(field).toHaveAttribute("max", "2100-12-31");

    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    expect(sent).toEqual({ dueOn: "2026-10-09" });
    expect(
      await screen.findByText(/in 8 days\. No projection to compare it with yet\./u),
    ).toBeInTheDocument();
    // The prompt is gone; moving is a second, quieter choice.
    expect(screen.getByRole("button", { name: "Move the deadline" })).toBeInTheDocument();
  });

  it("asks the learner to pick when there is no estimate to propose from", async () => {
    returns({
      modules: [module()],
      currentModuleId: MODULE,
      proposal: { moduleId: MODULE, dueOn: null },
    });
    render();

    const field = await screen.findByLabelText("Deadline for Ownership");
    expect(field).toHaveValue("");
    expect(
      screen.getByText("There's no estimate yet, so pick the date yourself."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
  });

  it("does not ask about a module you are not in", async () => {
    returns({ modules: [module()], currentModuleId: null, proposal: null });
    render();

    await screen.findByRole("heading", { name: "Ownership" });
    expect(screen.queryByLabelText("Deadline for Ownership")).not.toBeInTheDocument();
  });

  it("never shows a moved date without the one first committed to", async () => {
    returns({
      modules: [
        module({
          deadline: {
            dueOn: "2026-10-12",
            firstDueOn: "2026-10-05",
            moves: 2,
            status: { kind: "behind", daysLeft: 11, daysBehind: 3 },
          },
          projection: {
            status: "projected",
            units: 3,
            minutes: 90,
            startDay: "2026-10-01",
            examDay: "2026-10-15",
          },
        }),
      ],
    });
    render();

    expect(
      await screen.findByText(/in 11 days\. At your pace the exam lands on/u),
    ).toHaveTextContent("3 days late");
    expect(screen.getByText(/First committed for .+, and moved 2 times\./u)).toBeInTheDocument();
  });

  it("says a missed deadline once, with how late, and no more", async () => {
    returns({
      modules: [
        module({
          progress: { completed: 3, total: 3 },
          finishedAt: "2026-09-30T12:00:00.000Z",
          projection: { status: "finished" },
          deadline: {
            dueOn: "2026-09-27",
            firstDueOn: "2026-09-27",
            moves: 0,
            status: { kind: "missed", daysLate: 3 },
          },
        }),
      ],
    });
    render();

    expect(await screen.findByText(/Finished 3 days after its deadline/u)).toBeInTheDocument();
  });

  it("shows the server's reason when a commit is refused", async () => {
    server.use(
      http.put(`${API}/missions/${MISSION}/modules/${MODULE}/deadline`, () =>
        problemResponse(422, "deadline-in-past", "A deadline can't be in the past."),
      ),
    );
    returns({
      modules: [module()],
      currentModuleId: MODULE,
      proposal: { moduleId: MODULE, dueOn: "2026-10-09" },
    });
    render();

    await userEvent.click(await screen.findByRole("button", { name: "Commit" }));

    expect(await screen.findByText("A deadline can't be in the past.")).toBeInTheDocument();
  });
});

describe("the schedule", () => {
  it("labels a committed date as due and a derived one as projected", async () => {
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
          deadline: {
            dueOn: "2026-10-09",
            firstDueOn: "2026-10-09",
            moves: 0,
            status: { kind: "on-track", daysLeft: 8 },
          },
        }),
        module({
          id: "55555555-5555-4555-8555-555555555555",
          name: "Traits",
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
    expect(schedule.getByText(/^exam due /u)).toBeInTheDocument();
    expect(schedule.getByText(/^exam projected /u)).toBeInTheDocument();
    expect(
      schedule.getByText(
        /30 minutes a lesson \(the median of 4 timed lessons\) and 12 minutes a day/u,
      ),
    ).toBeInTheDocument();
  });

  it("shows a slow pace as the small number it is, never as zero", async () => {
    // 13 minutes in 28 days is 0.46 a day: measured, and not nothing.
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
    expect(schedule.queryByText(/and 0 minutes a day/u)).not.toBeInTheDocument();
  });

  it("says what is missing instead of projecting from nothing", async () => {
    returns({
      pace: { status: "unknown", missing: ["timed-lessons", "recent-time"], timedLessons: 1 },
      modules: [module()],
    });
    render();

    const schedule = within(await screen.findByRole("region", { name: "Schedule" }));
    expect(
      schedule.getByText(/No projections yet\. .+and there is 1\. They also need some focus time/u),
    ).toBeInTheDocument();
    expect(schedule.getByText("no date yet")).toBeInTheDocument();
  });
});
