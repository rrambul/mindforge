import { describe, expect, it } from "vitest";
import { defaultPastSession, pastSessionToInput, type PastSessionForm } from "./past-session.js";

/**
 * `Date` here reads the *device's* zone deliberately — see the note on `pastSessionToInput`. These
 * tests therefore assert relationships (duration, ordering, round-tripping) rather than absolute
 * UTC strings, which would only pass in whichever zone they were written in.
 */

const REFERENCE = new Date("2026-08-05T14:30:00");

function form(overrides: Partial<PastSessionForm> = {}): PastSessionForm {
  return { ...defaultPastSession(REFERENCE), ...overrides };
}

function inputOf(overrides: Partial<PastSessionForm> = {}) {
  const result = pastSessionToInput(form(overrides), REFERENCE);
  if ("problem" in result) throw new Error(`expected an input, got ${result.problem.code}`);
  return result.input;
}

function problemOf(overrides: Partial<PastSessionForm> = {}) {
  const result = pastSessionToInput(form(overrides), REFERENCE);
  if ("input" in result) throw new Error("expected a problem");
  return result.problem;
}

describe("defaultPastSession", () => {
  it("pre-fills every field so the common case is one edit", () => {
    // FR-F2: if backfilling is painful the data dies within two weeks. A blank form is painful.
    const prefilled = defaultPastSession(REFERENCE);
    expect(prefilled.date).not.toBe("");
    expect(prefilled.startTime).not.toBe("");
    expect(prefilled.minutes).toBeGreaterThan(0);
  });

  it("anchors the default to a block that ended about now", () => {
    // 14:30 now, 30 minutes long, so 14:00.
    expect(defaultPastSession(REFERENCE).startTime).toBe("14:00");
  });

  it("never pre-fills a session that has not happened yet", () => {
    // The bug this pins: rounding the *start* down to the hour and adding a fixed length puts the
    // session in the future for most of every hour — at 14:05 a 14:00 start plus 30 minutes ends at
    // 14:30. The pre-filled form then fails its own validation, which is the worst possible first
    // impression for the one flow FR-F2 says must not be painful.
    for (const minute of [0, 1, 5, 7, 29, 30, 31, 59]) {
      const reference = new Date(2026, 7, 5, 14, minute, 40);
      const prefilled = defaultPastSession(reference);
      expect(pastSessionToInput(prefilled, reference), `at 14:${minute}`).toHaveProperty("input");
    }
  });

  it("uses the local date, not the UTC one", () => {
    // toISOString().slice(0,10) would show yesterday to anyone west of Greenwich logging a session
    // today — which is the majority of this app's likely users.
    const lateEvening = new Date(2026, 7, 5, 23, 30, 0);
    expect(defaultPastSession(lateEvening).date).toBe("2026-08-05");
  });

  it("defaults to a duration that validates", () => {
    // A default of 0 would make the first thing you see an error.
    expect(pastSessionToInput(defaultPastSession(REFERENCE), REFERENCE)).toHaveProperty("input");
  });
});

describe("pastSessionToInput", () => {
  it("turns a date, a time, and a length into two instants", () => {
    const input = inputOf({ date: "2026-08-05", startTime: "09:00", minutes: 90 });
    expect(input.endedAt.getTime() - input.startedAt.getTime()).toBe(90 * 60_000);
  });

  it("reads the time in the device's zone, which is where the person was standing", () => {
    // "I worked at nine" means nine where you are. The result is an absolute instant, so every
    // later rollup can still bucket it by the profile's timezone.
    const input = inputOf({ date: "2026-08-05", startTime: "09:00", minutes: 30 });
    expect(input.startedAt.getHours()).toBe(9);
  });

  it("carries an optional intention, trimmed", () => {
    expect(inputOf({ intention: "  read chapter 4  " }).intention).toBe("read chapter 4");
  });

  it("omits an empty intention rather than sending a blank", () => {
    expect(inputOf({ intention: "   " })).not.toHaveProperty("intention");
  });

  it("carries only the debrief answers that were given", () => {
    // A partial debrief must stay partial, so the server can merge a later answer without erasing
    // what is already there.
    const input = inputOf({ hitIntention: "partly", energy: 3 });
    expect(input.hitIntention).toBe("partly");
    expect(input.energy).toBe(3);
    expect(input).not.toHaveProperty("focusQuality");
  });

  it("omits the debrief entirely when nothing was answered", () => {
    const input = inputOf();
    expect(input).not.toHaveProperty("hitIntention");
    expect(input).not.toHaveProperty("focusQuality");
    expect(input).not.toHaveProperty("energy");
  });

  describe("what it refuses", () => {
    it("refuses a session in the future", () => {
      // Unlike a stop that arrives before its start — where the block genuinely happened and
      // refusing would leave a timer running forever — a block in the future did not happen, and
      // recording it would put time into the week's totals that nobody spent.
      expect(problemOf({ startTime: "23:00", minutes: 120 })).toEqual({
        field: "startTime",
        code: "future",
      });
    });

    it("accepts a session that ends exactly now", () => {
      expect(inputOf({ startTime: "14:00", minutes: 30 }).endedAt).toEqual(REFERENCE);
    });

    it("refuses a missing date or time", () => {
      expect(problemOf({ date: "" })).toEqual({ field: "date", code: "required" });
      expect(problemOf({ startTime: "" })).toEqual({ field: "startTime", code: "required" });
    });

    it("refuses a date that does not parse", () => {
      expect(problemOf({ date: "not-a-date" })).toEqual({ field: "date", code: "invalid" });
    });

    it("refuses a duration below a minute", () => {
      expect(problemOf({ minutes: 0 })).toEqual({ field: "minutes", code: "required" });
      expect(problemOf({ minutes: -5 })).toEqual({ field: "minutes", code: "required" });
      // An empty number input yields NaN.
      expect(problemOf({ minutes: Number.NaN })).toEqual({ field: "minutes", code: "required" });
    });

    it("refuses a duration longer than a day, which is a typo", () => {
      // Letting it through would distort every average it lands in.
      expect(problemOf({ date: "2026-08-01", minutes: 24 * 60 + 1 })).toEqual({
        field: "minutes",
        code: "too_long",
      });
    });

    it("accepts exactly a day", () => {
      expect(inputOf({ date: "2026-08-01", startTime: "00:00", minutes: 24 * 60 })).toBeTruthy();
    });
  });
});
