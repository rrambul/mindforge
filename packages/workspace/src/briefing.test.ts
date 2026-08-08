import { describe, expect, it } from "vitest";

import { M3_ABSENCES, notTracked, renderBriefing, type BriefingInput } from "./briefing.js";

/**
 * The wording is the feature.
 *
 * These read like copy tests, and they are not: `BRIEFING.md` is consumed by a
 * model that plans a lesson from it. "0 items due" and "reviews are not tracked"
 * produce different teaching, and only one of them is true. So the assertions are
 * about what must never appear as much as about what must.
 */

const EMPTY: BriefingInput = {
  missionTopic: null,
  lessonCount: 0,
  recordCount: 0,
  zpdCandidates: [],
  skills: [],
  recentFriction: [],
  frictionWindowDays: 14,
  ...M3_ABSENCES,
};

const RICH: BriefingInput = {
  missionTopic: "Postgres row-level security",
  lessonCount: 6,
  recordCount: 4,
  zpdCandidates: [
    { next: "How SET LOCAL interacts with a connection pool.", fromRecord: "0007-rls-basics.md" },
    { next: "Writing a policy for a join table.", fromRecord: "0008-policies.md" },
  ],
  skills: [
    { name: "Postgres", perceivedLevel: "working" },
    { name: "SQL", perceivedLevel: null },
  ],
  recentFriction: [
    { kind: "too_hard", occurrences: 3 },
    { kind: "tooling", occurrences: 1 },
  ],
  frictionWindowDays: 14,
  ...M3_ABSENCES,
};

describe("renderBriefing", () => {
  it("renders a mission with history", () => {
    const briefing = renderBriefing(RICH);

    expect(briefing).toContain("Topic: Postgres row-level security");
    expect(briefing).toContain("Lessons written so far: 6");
    expect(briefing).toContain("How SET LOCAL interacts with a connection pool.");
  });

  it("tells the agent this file is an input it must not edit", () => {
    // `SKILL.md`'s own workspace inventory predates BRIEFING.md, so an agent
    // tidying to that inventory would happily rewrite or delete it — and the
    // deletion would diff as a real change if the exclude list were ever applied
    // in the wrong place.
    expect(renderBriefing(RICH)).toContain("regenerated every run and never saved back");
  });

  describe("what it must never say", () => {
    it("does not report zero due reviews", () => {
      // The one that would do real damage. A model reading "0 items due" plans a
      // lesson that skips revision, on the strength of a measurement nobody made.
      const briefing = renderBriefing(RICH);

      expect(briefing).not.toMatch(/0 (items|reviews) due/iu);
      expect(briefing).not.toMatch(/nothing due/iu);
      expect(briefing).toContain("Do not assume the learner has or has not revised anything");
    });

    it("does not present self-rated levels as measured", () => {
      const briefing = renderBriefing(RICH);

      expect(briefing).toContain("the learner's own estimate, not a score");
      expect(briefing).toContain("Postgres — self-rated: working");
    });

    it("says a skill was never rated rather than rating it zero", () => {
      expect(renderBriefing(RICH)).toContain("SQL — self-rated: not rated");
    });

    it("does not claim past lessons were read", () => {
      const briefing = renderBriefing(RICH);

      expect(briefing).toContain("Past lessons may or may not have been read");
      expect(briefing).not.toMatch(/0 lessons completed/iu);
    });

    it("carries an explicit warning against inferring zero from silence", () => {
      // The addendum in `skills/UNATTENDED.md` says the same thing. Repeating it
      // here is deliberate: the absences only work if the reader does not fill
      // them in, and this is the file where the absences appear.
      expect(renderBriefing(RICH)).toContain("is a guess dressed as evidence");
    });
  });

  describe("a brand-new mission", () => {
    it("tells the agent to teach anyway rather than ask", () => {
      // The largest stall risk in an unattended run: `SKILL.md` says to question
      // the user when the mission is thin, nothing answers, and the run ends
      // having written nothing while reporting success.
      const briefing = renderBriefing(EMPTY);

      expect(briefing).toContain("teach anyway");
      expect(briefing).toContain("there is nobody to ask");
    });

    it("says there is nothing to derive a ZPD from, rather than showing an empty list", () => {
      const briefing = renderBriefing(EMPTY);

      expect(briefing).toContain("nothing to derive a zone of proximal development from");
    });

    it("says the learner has rated no skills rather than listing none", () => {
      expect(renderBriefing(EMPTY)).toContain("has not rated any skills");
    });

    it("still renders every section", () => {
      const briefing = renderBriefing(EMPTY);

      for (const heading of [
        "## Where this mission stands",
        "## What to teach next",
        "## Skills",
        "## Due reviews",
        "## Past lesson outcomes",
        "## Recent friction",
      ]) {
        expect(briefing).toContain(heading);
      }
    });
  });

  describe("friction, the one measured signal", () => {
    it("names it as measured, so the agent weights it differently", () => {
      const briefing = renderBriefing(RICH);

      expect(briefing).toContain("too_hard — 3×");
      expect(briefing).toContain("This is measured,");
    });

    it("says none was logged, which is a real observation rather than an absence", () => {
      // The distinction the rest of this file exists to protect. `friction_events`
      // has existed since M1, so "none in 14 days" is something Mindforge actually
      // knows — unlike every other zero it declines to print.
      expect(renderBriefing(EMPTY)).toContain("No friction logged in the last 14 days");
    });
  });

  it("renders a tracked signal once one exists, without changing shape", () => {
    // Proof the union is a real seam rather than decoration: the day review
    // scheduling ships, deleting `M3_ABSENCES.dueReviews` is the whole change.
    const briefing = renderBriefing({
      ...RICH,
      dueReviews: ["Ownership — due today", "Borrowing — overdue 2 days"],
    });

    expect(briefing).toContain("- Ownership — due today");
    expect(briefing).not.toContain("Spaced repetition ships in a later release");
  });

  it("accepts a bespoke absence, for a signal that is missing for a different reason", () => {
    const briefing = renderBriefing({
      ...RICH,
      dueReviews: notTracked("The learner has paused reviews for this mission."),
    });

    expect(briefing).toContain("The learner has paused reviews for this mission.");
  });
});
