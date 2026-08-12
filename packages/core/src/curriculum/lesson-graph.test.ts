import { describe, expect, it } from "vitest";

import {
  deriveLessons,
  missionProgress,
  moduleOutcomes,
  moduleProgress,
  nextLesson,
  orderModule,
  type LessonNode,
} from "./lesson-graph.js";

/**
 * A bug in here is a confidently wrong number rather than a crash — a module that
 * says 40% when it is 20%, a lesson badged fundamental because nothing depends on
 * it, a "next" suggestion that is locked. That is why `packages/core` is held to
 * 100%, and why every test below names the wrong answer it rules out.
 */

const TRACK = "track-1";

function lesson(id: string, over: Partial<LessonNode> = {}): LessonNode {
  return {
    id,
    trackId: TRACK,
    status: "planned",
    difficulty: null,
    position: null,
    seq: null,
    completed: false,
    prerequisiteIds: [],
    ...over,
  };
}

describe("deriveLessons", () => {
  it("counts dependents rather than flagging them", () => {
    // FR-K6: the more lessons depend on one, the more fundamental it is. A boolean
    // could not rank a module's lessons by how much rests on them.
    const lessons = [
      lesson("a"),
      lesson("b", { prerequisiteIds: ["a"] }),
      lesson("c", { prerequisiteIds: ["a"] }),
    ];

    const derived = deriveLessons(lessons);

    expect(derived.get("a")).toMatchObject({ dependentCount: 2, fundamental: true });
    expect(derived.get("b")).toMatchObject({ dependentCount: 0, fundamental: false });
  });

  it("unblocks a lesson only when every prerequisite is finished", () => {
    const lessons = [
      lesson("a", { completed: true }),
      lesson("b"),
      lesson("c", { prerequisiteIds: ["a", "b"] }),
    ];

    const derived = deriveLessons(lessons);

    expect(derived.get("c")).toMatchObject({ unblocked: false, blockedBy: ["b"] });
  });

  it("names what is blocking, so the UI can say why", () => {
    const lessons = [lesson("a"), lesson("b"), lesson("c", { prerequisiteIds: ["a", "b"] })];
    expect(deriveLessons(lessons).get("c")!.blockedBy).toEqual(["a", "b"]);
  });

  it("unblocks a lesson with no prerequisites at all", () => {
    expect(deriveLessons([lesson("a")]).get("a")).toMatchObject({
      unblocked: true,
      blockedBy: [],
    });
  });

  it("says nothing about whether the lesson itself is done", () => {
    // Unblocked answers "may this be started", not "is this finished". Folding the
    // two together would drop every completed lesson out of a module's unblocked
    // count and make a finished module look like a stuck one.
    const derived = deriveLessons([lesson("a", { completed: true })]);
    expect(derived.get("a")!.unblocked).toBe(true);
  });

  it("is not blocked by a prerequisite outside the set it was given", () => {
    // A caller filtering to one module can produce this; the database cannot,
    // because `lesson_edges` cascades. A lesson locked behind a row nobody loaded
    // would be locked forever with nothing on screen to explain it.
    const derived = deriveLessons([lesson("b", { prerequisiteIds: ["elsewhere"] })]);
    expect(derived.get("b")).toMatchObject({ unblocked: true, blockedBy: [] });
  });

  it("does not count a dependent that is outside the set either", () => {
    const derived = deriveLessons([lesson("a"), lesson("b", { prerequisiteIds: ["ghost"] })]);
    expect(derived.get("a")!.dependentCount).toBe(0);
  });

  it("returns an empty map for no lessons", () => {
    expect(deriveLessons([]).size).toBe(0);
  });
});

describe("orderModule", () => {
  it("sorts by difficulty ascending", () => {
    const ordered = orderModule([
      lesson("hard", { difficulty: 4 }),
      lesson("easy", { difficulty: 1 }),
      lesson("middling", { difficulty: 3 }),
    ]);

    expect(ordered.map((l) => l.id)).toEqual(["easy", "middling", "hard"]);
  });

  it("puts a lesson with no difficulty last, never first", () => {
    // Reading an absent number as 0 would put every unrated lesson at the front,
    // and "start with the easiest" would mean "start with the ungraded ones".
    const ordered = orderModule([lesson("unrated"), lesson("rated", { difficulty: 5 })]);
    expect(ordered.map((l) => l.id)).toEqual(["rated", "unrated"]);
  });

  it("breaks a difficulty tie with the plan's own row order", () => {
    const ordered = orderModule([
      lesson("second", { difficulty: 2, position: 2 }),
      lesson("first", { difficulty: 2, position: 1 }),
    ]);

    expect(ordered.map((l) => l.id)).toEqual(["first", "second"]);
  });

  it("falls through to the file's sequence, then to the id", () => {
    const bySeq = orderModule([lesson("later", { seq: 9 }), lesson("earlier", { seq: 2 })]);
    expect(bySeq.map((l) => l.id)).toEqual(["earlier", "later"]);

    // Total, so two renders of one module never disagree.
    const byId = orderModule([lesson("b"), lesson("a")]);
    expect(byId.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("does not mutate what it was given", () => {
    const lessons = [lesson("b", { difficulty: 2 }), lesson("a", { difficulty: 1 })];
    orderModule(lessons);
    expect(lessons.map((l) => l.id)).toEqual(["b", "a"]);
  });
});

describe("moduleProgress", () => {
  it("counts completed over everything the module has", () => {
    const progress = moduleProgress([lesson("a", { completed: true }), lesson("b"), lesson("c")]);

    expect(progress).toEqual({ completed: 1, total: 3 });
  });

  it("counts an off-plan lesson in both halves once it is finished", () => {
    // The denominator is the module as it now stands, which is what lets it stay
    // honest without a "was this planned?" flag.
    const progress = moduleProgress([
      lesson("planned", { completed: true }),
      lesson("detour", { status: "generated", completed: true, seq: 4 }),
    ]);

    expect(progress).toEqual({ completed: 2, total: 2 });
  });

  it("returns null for a module with no lessons, never a zero", () => {
    // Non-negotiable 10. A 0% bar is a claim that something was measured; this
    // module simply has no plan yet, and the UI has to say that instead.
    expect(moduleProgress([])).toBeNull();
  });
});

describe("missionProgress", () => {
  it("sums the planned modules into one fraction of lessons", () => {
    const progress = missionProgress([
      { completed: 2, total: 5 },
      { completed: 1, total: 3 },
    ]);

    expect(progress).toEqual({ completed: 3, total: 8, modulesNotPlanned: 0 });
  });

  it("counts lessons rather than modules, because modules are not the same size", () => {
    // Finishing a three-lesson module is not the same amount of work as finishing an
    // eight-lesson one, and a fraction over modules would say it was.
    const progress = missionProgress([
      { completed: 3, total: 3 },
      { completed: 0, total: 8 },
    ]);

    expect(progress).toEqual({ completed: 3, total: 11, modulesNotPlanned: 0 });
  });

  it("leaves an unplanned module out of the fraction and says how many there were", () => {
    // Counting it as 0/0 would change nothing; counting it as some notional size would
    // make the bar *fall* every time the curriculum grew a subtopic. Neither is a thing
    // that happened, so it is excluded and reported.
    const progress = missionProgress([{ completed: 2, total: 4 }, null, null]);

    expect(progress).toEqual({ completed: 2, total: 4, modulesNotPlanned: 2 });
  });

  it("returns null when nothing is planned at all, never a zero", () => {
    // A fresh mission before its first curriculum run. Same rule as a module's, one
    // level up (non-negotiable 10).
    expect(missionProgress([null, null])).toBeNull();
    expect(missionProgress([])).toBeNull();
  });

  it("reports a finished mission as complete rather than as anything softer", () => {
    // Honesty runs both ways: nothing decays a completed lesson back out of the count.
    expect(missionProgress([{ completed: 4, total: 4 }])).toEqual({
      completed: 4,
      total: 4,
      modulesNotPlanned: 0,
    });
  });
});

describe("nextLesson", () => {
  const OTHER = "track-2";

  it("takes the first unblocked, unfinished lesson in module order", () => {
    const lessons = [
      lesson("late", { trackId: OTHER, difficulty: 1 }),
      lesson("early", { difficulty: 3 }),
    ];

    expect(nextLesson(lessons, [TRACK, OTHER])!.id).toBe("early");
  });

  it("prefers the easiest unblocked lesson within a module", () => {
    const lessons = [lesson("hard", { difficulty: 5 }), lesson("easy", { difficulty: 1 })];
    expect(nextLesson(lessons, [TRACK])!.id).toBe("easy");
  });

  it("skips a locked lesson even when it is the easiest", () => {
    // The whole point of the graph: difficulty orders, dependencies gate.
    const lessons = [
      lesson("gate", { difficulty: 4 }),
      lesson("locked", { difficulty: 1, prerequisiteIds: ["gate"] }),
    ];

    expect(nextLesson(lessons, [TRACK])!.id).toBe("gate");
  });

  it("skips a finished lesson and moves to the next module when one is done", () => {
    const lessons = [
      lesson("done", { completed: true, difficulty: 1 }),
      lesson("next-up", { trackId: OTHER, difficulty: 2 }),
    ];

    expect(nextLesson(lessons, [TRACK, OTHER])!.id).toBe("next-up");
  });

  it("suggests a written but unread lesson, and says it is written", () => {
    // Generating a new lesson while an unread one waits is how a curriculum turns
    // into a backlog. `status` is what lets the caller say "read this" instead.
    const lessons = [
      lesson("unread", { status: "generated", seq: 1, difficulty: 2 }),
      lesson("planned-next", { difficulty: 3 }),
    ];

    expect(nextLesson(lessons, [TRACK])).toMatchObject({
      id: "unread",
      status: "generated",
    });
  });

  it("never suggests a lesson that belongs to no module", () => {
    // Module order has nothing to say about it, and an off-plan lesson was a
    // deliberate detour rather than the plan asking for something.
    const lessons = [lesson("detour", { trackId: null, difficulty: 1 })];
    expect(nextLesson(lessons, [TRACK])).toBeNull();
  });

  it("returns null when every lesson is finished or locked", () => {
    // The blocker is an off-plan lesson, so it is unfinished, it locks what
    // depends on it, and it is not itself something the plan can suggest.
    const lessons = [
      lesson("done", { completed: true }),
      lesson("blocker", { trackId: null }),
      lesson("locked", { prerequisiteIds: ["blocker"] }),
    ];

    expect(nextLesson(lessons, [TRACK, "track-nothing-in"])).toBeNull();
  });

  it("returns null when there is nothing at all", () => {
    expect(nextLesson([], [])).toBeNull();
  });
});

describe("moduleOutcomes", () => {
  it("counts how the finished lessons landed", () => {
    expect(
      moduleOutcomes([
        { completed: true, outcome: "understood" },
        { completed: true, outcome: "understood" },
        { completed: true, outcome: "shaky" },
        { completed: true, outcome: "lost" },
        { completed: false, outcome: null },
      ]),
    ).toEqual({ understood: 2, shaky: 1, lost: 1, unrecorded: 0 });
  });

  it("counts a completion with no outcome rather than dropping it", () => {
    // The four counts have to sum to the module's `completed`, or the screen shows
    // three outcomes out of five finished and leaves the other two to guesswork.
    const counts = moduleOutcomes([
      { completed: true, outcome: "understood" },
      { completed: true, outcome: null },
    ]);

    expect(counts).toEqual({ understood: 1, shaky: 0, lost: 0, unrecorded: 1 });
  });

  it("ignores an outcome on a lesson that is not completed", () => {
    // Not a state the constraints allow, but the tally must not invent a finished
    // lesson from a stale column if one ever appears.
    expect(moduleOutcomes([{ completed: false, outcome: "shaky" }])).toEqual({
      understood: 0,
      shaky: 0,
      lost: 0,
      unrecorded: 0,
    });
  });

  it("returns null for a module with no lessons, and zeros for one with none finished", () => {
    // Null is "not planned yet". Zeros are a measurement: five planned, none done.
    expect(moduleOutcomes([])).toBeNull();
    expect(moduleOutcomes([{ completed: false, outcome: null }])).toEqual({
      understood: 0,
      shaky: 0,
      lost: 0,
      unrecorded: 0,
    });
  });
});
