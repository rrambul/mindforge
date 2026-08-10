import { describe, expect, it } from "vitest";
import {
  readFirstRun,
  shouldOfferFirstRun,
  stepNumber,
  writeFirstRun,
  type FirstRunState,
} from "./first-run-state.js";

/** A storage that can be told to misbehave, which is the interesting half of this module. */
function fakeStorage(initial: string | null = null, throws = false) {
  let value = initial;
  return {
    getItem: () => {
      if (throws) throw new Error("storage disabled");
      return value;
    },
    setItem: (_key: string, next: string) => {
      if (throws) throw new Error("quota exceeded");
      value = next;
    },
    removeItem: () => {
      value = null;
    },
    get current() {
      return value;
    },
  };
}

describe("readFirstRun", () => {
  it("starts at the first step when there is nothing stored", () => {
    expect(readFirstRun(fakeStorage())).toEqual({ step: "mission" });
  });

  it("round-trips through writeFirstRun", () => {
    const storage = fakeStorage();
    const state: FirstRunState = { step: "focus", missionId: "m1" };

    writeFirstRun(state, storage);
    expect(readFirstRun(storage)).toEqual(state);
  });

  it("keeps the ids of what has been created, so a resume does not duplicate them", () => {
    // Each step builds on the last. Losing the mission id mid-way would mean a resumed tour creating a
    // second mission, which is the demo-data mess §5.3 rules out.
    const storage = fakeStorage();
    writeFirstRun({ step: "focus", missionId: "m1" }, storage);

    expect(readFirstRun(storage)).toMatchObject({
      missionId: "m1",
    });
  });

  describe("when the stored value is unusable", () => {
    it("starts fresh on malformed JSON rather than throwing", () => {
      // This runs before the app renders, so a parse error here would take the whole app down over
      // something that does not matter.
      expect(readFirstRun(fakeStorage("{not json"))).toEqual({ step: "mission" });
    });

    it("starts fresh on a value that is not an object", () => {
      expect(readFirstRun(fakeStorage('"focus"'))).toEqual({ step: "mission" });
      expect(readFirstRun(fakeStorage("null"))).toEqual({ step: "mission" });
    });

    it("restarts on a step this build does not have", () => {
      // Written by a newer version and then downgraded. Rendering a step that does not exist would be
      // a blank screen with no way out.
      expect(readFirstRun(fakeStorage('{"step":"weekly-review"}')).step).toBe("mission");
    });

    it("ignores ids of the wrong type", () => {
      const state = readFirstRun(fakeStorage('{"step":"focus","missionId":42}'));
      expect(state.missionId).toBeUndefined();
    });

    it("starts fresh when storage itself throws", () => {
      // Private browsing, or storage disabled entirely.
      expect(readFirstRun(fakeStorage(null, true))).toEqual({ step: "mission" });
    });
  });

  it("does not throw when a write fails", () => {
    // A full quota must not turn into an exception on every keystroke; a restarted tour is a much
    // better failure.
    expect(() => writeFirstRun({ step: "focus" }, fakeStorage(null, true))).not.toThrow();
  });
});

describe("stepNumber", () => {
  it("counts from one", () => {
    expect(stepNumber("mission")).toBe(1);
    expect(stepNumber("focus")).toBe(2);
  });

  it("does not report a fifth step", () => {
    // `done` is a state, not a step — "Step 5 of 4" is nonsense.
    expect(stepNumber("done")).toBe(2);
  });
});

describe("shouldOfferFirstRun", () => {
  it("offers the tour to an empty account", () => {
    expect(shouldOfferFirstRun({ step: "mission" }, 0)).toBe(true);
  });

  it("does not offer it to someone who already has a mission", () => {
    // Someone who created one by hand does not need to be shown how.
    expect(shouldOfferFirstRun({ step: "mission" }, 1)).toBe(false);
  });

  it("still offers to resume mid-tour, even though a mission now exists", () => {
    // The tour created that mission. Counting it as "already set up" would abandon the user at step 2.
    expect(shouldOfferFirstRun({ step: "focus", missionId: "m1" }, 1)).toBe(true);
  });

  it("stops offering once it is finished", () => {
    expect(shouldOfferFirstRun({ step: "done", missionId: "m1" }, 1)).toBe(false);
  });

  it("stops offering once dismissed", () => {
    // "Not now" has to mean it, or the banner becomes something to be dismissed daily.
    expect(shouldOfferFirstRun({ step: "mission", dismissed: true }, 0)).toBe(false);
  });

  it("offers again to an account that has been emptied", () => {
    // Decided from real data rather than a flag, so deleting everything genuinely resets the offer.
    expect(shouldOfferFirstRun({ step: "mission" }, 0)).toBe(true);
  });
});
