import { describe, expect, it } from "vitest";

import {
  BRIEFING_ABSENCES,
  NO_TRACK,
  notTracked,
  renderBriefing,
  type BriefingInput,
  type CurrentTrack,
} from "./briefing.js";

/**
 * The wording is the feature.
 *
 * These read like copy tests, and they are not: `BRIEFING.md` is consumed by a
 * model that plans a lesson from it. "0 lessons completed" and "outcomes are not
 * tracked" produce different teaching, and only one of them is true. So the
 * assertions are about what must never appear as much as about what must.
 */

const TRACK: CurrentTrack = {
  slug: "rls-basics",
  name: "RLS fundamentals",
  outcome: "Read a policy and say which rows it lets through",
  position: 2,
  totalTracks: 9,
  prerequisites: ["Postgres fundamentals"],
  lessons: [{ seq: 7, title: "Policies and roles" }],
};

const EMPTY: BriefingInput = {
  missionTopic: null,
  lessonCount: 0,
  recordCount: 0,
  currentTrack: NO_TRACK.noCurriculum,
  zpdCandidates: [],
  ...BRIEFING_ABSENCES,
};

const RICH: BriefingInput = {
  missionTopic: "Postgres row-level security",
  lessonCount: 6,
  recordCount: 4,
  currentTrack: TRACK,
  zpdCandidates: [
    { next: "How SET LOCAL interacts with a connection pool.", fromRecord: "0007-rls-basics.md" },
    { next: "Writing a policy for a join table.", fromRecord: "0008-policies.md" },
  ],
  ...BRIEFING_ABSENCES,
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

    it("still renders every section", () => {
      const briefing = renderBriefing(EMPTY);

      for (const heading of [
        "## Where this mission stands",
        "## The module you are teaching in",
        "## What to teach next",
        "## Past lesson outcomes",
        "## A note on what is missing",
      ]) {
        expect(briefing).toContain(heading);
      }
    });
  });

  it("renders a tracked signal once one exists, without changing shape", () => {
    // Proof the union is a real seam rather than decoration: the day the in-app
    // reader ships, deleting `BRIEFING_ABSENCES.lessonOutcomes` is the whole change.
    const briefing = renderBriefing({
      ...RICH,
      lessonOutcomes: ["0007 Policies and roles — understood", "0008 Joins — shaky"],
    });

    expect(briefing).toContain("- 0007 Policies and roles — understood");
    expect(briefing).not.toContain("The in-app reader is not shipped");
  });

  it("accepts a bespoke absence, for a signal that is missing for a different reason", () => {
    const briefing = renderBriefing({
      ...RICH,
      lessonOutcomes: notTracked("The learner has hidden lesson outcomes from runs."),
    });

    expect(briefing).toContain("The learner has hidden lesson outcomes from runs.");
  });
});

describe("the module a run is teaching in", () => {
  it("names the module, its place in the curriculum, and its outcome", () => {
    const briefing = renderBriefing(RICH);

    expect(briefing).toContain("**RLS fundamentals** — subtopic 2 of 9");
    expect(briefing).toContain("Read a policy and say which rows it lets through");
  });

  it("gives the meta tag the lesson must carry, with the slug filled in", () => {
    // The one thing in this section the agent cannot get right by reasoning: the
    // slug is a stable identifier it has no other source for, and a lesson
    // without the tag is filed under no module.
    expect(renderBriefing(RICH)).toContain('<meta name="mindforge:track" content="rls-basics">');
  });

  it("says one lesson and stop", () => {
    // Lessons are generated lazily, one per run, after the learner has done the
    // last one. A run that writes four has guessed at three.
    expect(renderBriefing(RICH)).toContain("Write exactly one lesson and stop");
  });

  it("lists the lessons already in the module so the agent does not repeat one", () => {
    expect(renderBriefing(RICH)).toContain("0007 — Policies and roles");
  });

  it("says the module's first lesson is the first, rather than showing an empty list", () => {
    const briefing = renderBriefing({
      ...RICH,
      currentTrack: { ...TRACK, lessons: [] },
    });

    expect(briefing).toContain("this is the module's first lesson");
  });

  it("does not claim a prerequisite module was learnt, only worked through", () => {
    // Nothing measures it. `lessonOutcomes` is a NotTracked a section down, and
    // a briefing that says "the learner knows Postgres fundamentals" contradicts
    // it in the same file.
    const briefing = renderBriefing(RICH);

    expect(briefing).toContain("Built on: Postgres fundamentals");
    expect(briefing).toContain("not the same as having proved anything");
  });

  it("omits the built-on line when the module has no prerequisites", () => {
    const briefing = renderBriefing({
      ...RICH,
      currentTrack: { ...TRACK, prerequisites: [] },
    });

    expect(briefing).not.toContain("Built on:");
  });

  it("tells the agent not to write a curriculum when the mission has none", () => {
    // Structure and material are produced by separate skills on purpose, so the
    // structure can be revised without discarding the material. An agent that
    // helpfully invents one has taken that apart.
    const briefing = renderBriefing(EMPTY);

    expect(briefing).toContain("no CURRICULUM.md yet");
    expect(briefing).toContain("do not invent a curriculum or write one");
  });

  it("distinguishes having no curriculum from having no module open", () => {
    // Two different facts calling for two different behaviours, which is why the
    // field is a union rather than a nullable object. Only in the second case is
    // omitting the meta tag a decision rather than the only option.
    const briefing = renderBriefing({ ...RICH, currentTrack: NO_TRACK.noneOpen });

    expect(briefing).toContain("no module is currently open");
    expect(briefing).toContain("leave the lesson's `mindforge:track` meta tag off");
    expect(briefing).not.toContain("no CURRICULUM.md yet");
  });

  it("never renders a module as a fraction of lessons done", () => {
    // Lessons are still generated lazily, so the briefing has no honest
    // denominator. "3 of 8" would be an estimate rendered as a fact.
    const briefing = renderBriefing(RICH);

    expect(briefing).not.toMatch(/\d+\s*(of|\/)\s*\d+\s*lessons/iu);
    expect(briefing).not.toContain("% complete");
  });
});

describe("a module the curriculum left thin", () => {
  it("says the curriculum recorded no outcome rather than showing a blank", () => {
    const briefing = renderBriefing({
      ...RICH,
      currentTrack: { ...TRACK, outcome: null },
    });

    expect(briefing).toContain("did not record an outcome for this module");
  });
});
