import { describe, expect, it } from "vitest";
import { FocusSessionNotRunning, FocusSessionNotStopped, SessionInFuture } from "./errors.js";
import { FocusSession, type FocusSessionSnapshot } from "./focus-session.js";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const START = new Date("2026-08-05T09:00:00Z");
const LATER = new Date("2026-08-05T09:40:00Z");

const NO_ATTACHMENTS = { missionId: null, resourceId: null, skillId: null, taskId: null };
const NO_DEBRIEF = { hitIntention: null, focusQuality: null, energy: null, note: null };

function started(intention: string | null = "get the parser handling nested groups"): FocusSession {
  return FocusSession.start({
    id: ID,
    userId: USER,
    intention,
    plannedMinutes: null,
    attachments: NO_ATTACHMENTS,
    now: START,
  });
}

function snapshotOf(overrides: Partial<FocusSessionSnapshot> = {}): FocusSessionSnapshot {
  return {
    id: ID,
    userId: USER,
    intention: null,
    startedAt: START,
    endedAt: null,
    plannedMinutes: null,
    entryMode: "timer",
    createdAt: START,
    ...NO_DEBRIEF,
    ...NO_ATTACHMENTS,
    ...overrides,
  };
}

describe("start", () => {
  it("opens a running session with no end", () => {
    const session = started();
    expect(session.isRunning).toBe(true);
    expect(session.endedAt).toBeNull();
    // Elapsed, not duration: a running session has no duration yet.
    expect(session.minutes).toBeNull();
  });

  it("records the one field §5.3 asks at start", () => {
    expect(started().intention).toBe("get the parser handling nested groups");
  });

  it("starts without an intention, because a prompt you cannot skip stops you starting", () => {
    expect(started(null).intention).toBeNull();
  });

  it("is a timer entry, distinguishable from something backfilled", () => {
    expect(started().entryMode).toBe("timer");
  });
});

describe("stop", () => {
  it("ends the session at the clock", () => {
    const session = started();
    session.stop(LATER);

    expect(session.isRunning).toBe(false);
    expect(session.endedAt).toEqual(LATER);
    expect(session.minutes).toBe(40);
  });

  it("refuses a session that was already stopped", () => {
    const session = started();
    session.stop(LATER);
    expect(() => session.stop(LATER)).toThrow(FocusSessionNotRunning);
  });

  it("clamps a stop that arrives before the start instead of refusing it", () => {
    // A mid-session NTP correction, or a queued stop replayed out of order. The block genuinely
    // happened, and refusing to end it would leave a timer running forever — so it becomes one
    // minute rather than a negative duration poisoning every sum it lands in.
    const session = started();
    session.stop(new Date("2026-08-05T08:00:00Z"));

    expect(session.isRunning).toBe(false);
    expect(session.minutes).toBe(1);
  });

  it("clamps a stop at exactly the start instant", () => {
    const session = started();
    session.stop(START);
    expect(session.minutes).toBe(1);
  });
});

describe("writeDebrief", () => {
  it("refuses to debrief a session that is still running", () => {
    // §5.3's flow is stop, then debrief. Debriefing a live session would be rating a block you
    // have not finished.
    expect(() => started().writeDebrief({ hitIntention: "yes" })).toThrow(FocusSessionNotStopped);
  });

  it("records the three answers", () => {
    const session = started();
    session.stop(LATER);
    session.writeDebrief({ hitIntention: "partly", focusQuality: 4, energy: 3 });

    expect(session.debrief).toEqual({
      hitIntention: "partly",
      focusQuality: 4,
      energy: 3,
      note: null,
    });
  });

  it("merges, so a second partial answer does not erase the first", () => {
    // The debrief is allowed to be answered across two moments — thirty seconds is not always
    // available at once.
    const session = started();
    session.stop(LATER);
    session.writeDebrief({ hitIntention: "yes" });
    session.writeDebrief({ energy: 2 });

    expect(session.debrief.hitIntention).toBe("yes");
    expect(session.debrief.energy).toBe(2);
  });

  it("lets a note be cleared but not clobbered by omission", () => {
    const session = started();
    session.stop(LATER);
    session.writeDebrief({ note: "build tool broke twice" });
    session.writeDebrief({ energy: 4 });
    expect(session.debrief.note).toBe("build tool broke twice");

    session.writeDebrief({ note: null });
    expect(session.debrief.note).toBeNull();
  });

  it.each([0, 6, 2.5, -1])("rejects a rating of %s", (value) => {
    const session = started();
    session.stop(LATER);
    expect(() => session.writeDebrief({ focusQuality: value })).toThrow(RangeError);
    expect(() => session.writeDebrief({ energy: value })).toThrow(RangeError);
  });
});

describe("producedLearning", () => {
  it("is true for a block that arrived somewhere", () => {
    const session = started();
    session.stop(LATER);
    session.writeDebrief({ hitIntention: "partly" });
    expect(session.producedLearning).toBe(true);
  });

  it("is false for a block that went nowhere, and for one never debriefed", () => {
    // The second half matters: counting an unanswered debrief as productive would let the ember
    // share drift upward simply because you stopped filling it in.
    const missed = started();
    missed.stop(LATER);
    missed.writeDebrief({ hitIntention: "no" });
    expect(missed.producedLearning).toBe(false);

    const silent = started();
    silent.stop(LATER);
    expect(silent.producedLearning).toBe(false);
  });
});

describe("record", () => {
  it("labels something entered for today as manual", () => {
    const session = FocusSession.record({
      id: ID,
      userId: USER,
      intention: "read chapter 4",
      startedAt: START,
      endedAt: LATER,
      debrief: NO_DEBRIEF,
      attachments: NO_ATTACHMENTS,
      now: new Date("2026-08-05T22:00:00Z"),
    });

    expect(session.entryMode).toBe("manual");
    expect(session.isRunning).toBe(false);
    expect(session.minutes).toBe(40);
  });

  it("labels something older as backfilled", () => {
    // FR-F2: distinguishable without being second-class. An insight built only on timer
    // sessions describes the days you remembered to press start.
    const session = FocusSession.record({
      id: ID,
      userId: USER,
      intention: null,
      startedAt: START,
      endedAt: LATER,
      debrief: NO_DEBRIEF,
      attachments: NO_ATTACHMENTS,
      now: new Date("2026-08-09T10:00:00Z"),
    });

    expect(session.entryMode).toBe("backfilled");
  });

  describe("a session dated in the future", () => {
    // A device with a skewed clock, or a hand-typed date. Either produces a block that sorts to the top
    // of every recent list forever and counts toward a `focus_hours` goal for work that has not
    // happened. The friction path clamps for the same reason; a session is refused instead, because
    // both of its boundaries are the user's own claim and moving one would record a duration they did
    // not enter.
    it("is refused when it starts in the future", () => {
      expect(() =>
        FocusSession.record({
          id: ID,
          userId: USER,
          intention: null,
          startedAt: new Date("2026-09-01T10:00:00Z"),
          endedAt: new Date("2026-09-01T10:40:00Z"),
          debrief: NO_DEBRIEF,
          attachments: NO_ATTACHMENTS,
          now: LATER,
        }),
      ).toThrow(SessionInFuture);
    });

    it("is refused when it ends in the future, even having started in the past", () => {
      expect(() =>
        FocusSession.record({
          id: ID,
          userId: USER,
          intention: null,
          startedAt: START,
          endedAt: new Date("2026-09-01T10:00:00Z"),
          debrief: NO_DEBRIEF,
          attachments: NO_ATTACHMENTS,
          now: LATER,
        }),
      ).toThrow(SessionInFuture);
    });

    it("accepts a session that ends exactly now", () => {
      // The ordinary case for a manual entry made the moment a block finished — a strict comparison
      // would reject it.
      expect(() =>
        FocusSession.record({
          id: ID,
          userId: USER,
          intention: null,
          startedAt: START,
          endedAt: LATER,
          debrief: NO_DEBRIEF,
          attachments: NO_ATTACHMENTS,
          now: LATER,
        }),
      ).not.toThrow();
    });
  });

  it("carries a debrief straight in, since you already know how it went", () => {
    const session = FocusSession.record({
      id: ID,
      userId: USER,
      intention: null,
      startedAt: START,
      endedAt: LATER,
      debrief: { hitIntention: "yes", focusQuality: 5, energy: 4, note: null },
      attachments: NO_ATTACHMENTS,
      now: LATER,
    });

    expect(session.debrief.focusQuality).toBe(5);
    expect(session.producedLearning).toBe(true);
  });

  it("refuses a session that ends before it starts", () => {
    expect(() =>
      FocusSession.record({
        id: ID,
        userId: USER,
        intention: null,
        startedAt: LATER,
        endedAt: START,
        debrief: NO_DEBRIEF,
        attachments: NO_ATTACHMENTS,
        now: LATER,
      }),
    ).toThrow(RangeError);
  });
});

describe("fromSnapshot", () => {
  it("round-trips through toSnapshot", () => {
    const snapshot = snapshotOf({
      endedAt: LATER,
      hitIntention: "yes",
      focusQuality: 4,
      energy: 3,
      note: "went well",
      missionId: "33333333-3333-4333-8333-333333333333",
      entryMode: "manual",
      plannedMinutes: 45,
    });
    expect(FocusSession.fromSnapshot(snapshot).toSnapshot()).toEqual(snapshot);
  });

  it("re-checks invariants, because a row can be edited by hand", () => {
    expect(() =>
      FocusSession.fromSnapshot(snapshotOf({ endedAt: new Date("2026-08-05T08:00:00Z") })),
    ).toThrow(RangeError);
    expect(() => FocusSession.fromSnapshot(snapshotOf({ focusQuality: 9 }))).toThrow(RangeError);
  });

  it("keeps a running session running", () => {
    expect(FocusSession.fromSnapshot(snapshotOf()).isRunning).toBe(true);
  });
});
