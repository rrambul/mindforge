import { describe, expect, it } from "vitest";
import { emberShare, frictionSplit, splitSession, type SessionFriction } from "./split.js";

const learned = { producedLearning: true };
const didnt = { producedLearning: false };

function session(partial: Partial<SessionFriction> = {}): SessionFriction {
  return { minutes: 60, outcome: didnt, events: [], ...partial };
}

describe("splitSession", () => {
  it("attributes nothing when the session hit no friction", () => {
    // An hour you never noticed anything about is not an hour of demonstrated productive struggle.
    // Its minutes are focus minutes and nothing else — the two columns deliberately do not sum to
    // the third.
    expect(splitSession(session())).toEqual({
      emberMinutes: 0,
      slagMinutes: 0,
      emberShare: null,
    });
  });

  it("gives the whole session to a single event's class", () => {
    expect(splitSession(session({ events: [{ type: "tooling", intensity: 3 }] }))).toEqual({
      emberMinutes: 0,
      slagMinutes: 60,
      emberShare: 0,
    });
  });

  it("weights the split by intensity", () => {
    // The documented example: an hour with one shrugged-off interruption and one bruising stretch
    // of productive struggle was mostly the second thing.
    const result = splitSession(
      session({
        events: [
          { type: "interruption", intensity: 1 },
          { type: "productive_struggle", intensity: 5 },
        ],
      }),
    );
    expect(result).toEqual({ emberMinutes: 50, slagMinutes: 10, emberShare: 50 / 60 });
  });

  it("keeps the total exact when the shares do not divide evenly", () => {
    // 60 minutes across weights 3 and 4 is 25.71 for tooling and 34.29 for the struggle. Flooring
    // both loses a minute every time, and over a month the drift lands entirely in whichever class
    // rounds down. The spare minute goes to the larger remainder, which here is tooling's .71.
    const result = splitSession(
      session({
        events: [
          { type: "tooling", intensity: 3 },
          { type: "productive_struggle", intensity: 4 },
        ],
      }),
    );
    expect(result.emberMinutes + result.slagMinutes).toBe(60);
    expect(result).toEqual({ emberMinutes: 34, slagMinutes: 26, emberShare: 34 / 60 });
  });

  it("hands a tied remainder to the earlier event, so the result is stable", () => {
    // Three equal weights over malformed-by-one minutes. Which event gets the spare minute must not
    // depend on the sort implementation, or the same input produces two different rows.
    const result = splitSession(
      session({
        minutes: 10,
        events: [
          { type: "productive_struggle", intensity: 2 },
          { type: "tooling", intensity: 2 },
          { type: "tooling", intensity: 2 },
        ],
      }),
    );
    expect(result.emberMinutes + result.slagMinutes).toBe(10);
    expect(result.emberMinutes).toBe(4);
  });

  it("classifies a pushed-through hard stretch as ember and an abandoned one as slag", () => {
    const events = [{ type: "too_hard" as const, intensity: 4 }];
    expect(splitSession(session({ events, outcome: learned })).emberMinutes).toBe(60);
    expect(splitSession(session({ events, outcome: didnt })).slagMinutes).toBe(60);
  });

  it("attributes nothing from a zero-length session", () => {
    // A session logged and stopped in the same second still carries its friction taps. There are no
    // minutes to divide, and inventing one would make an accidental tap look like real time lost.
    const result = splitSession(
      session({ minutes: 0, events: [{ type: "tooling", intensity: 3 }] }),
    );
    expect(result).toEqual({ emberMinutes: 0, slagMinutes: 0, emberShare: null });
  });

  it("rounds fractional session minutes before dividing them", () => {
    expect(
      splitSession(session({ minutes: 44.6, events: [{ type: "tooling", intensity: 3 }] }))
        .slagMinutes,
    ).toBe(45);
  });

  it("rejects negative session minutes rather than skewing the ratio", () => {
    expect(() => splitSession(session({ minutes: -5 }))).toThrow(RangeError);
  });

  it.each([0, 6, 2.5, Number.NaN])(
    "rejects an intensity of %s rather than clamping it",
    (intensity) => {
      // Clamping a 9 to a 5 produces a confidently wrong headline number, which is the one failure
      // this product calls a bug regardless of what else improves.
      expect(() => splitSession(session({ events: [{ type: "tooling", intensity }] }))).toThrow(
        RangeError,
      );
    },
  );
});

describe("frictionSplit", () => {
  it("reports null rather than zero when nothing was attributed", () => {
    // Zero says every minute of friction you hit was wasted, which is a measurement. Null says you
    // logged none, which is the absence of one.
    expect(frictionSplit([])).toEqual({ emberMinutes: 0, slagMinutes: 0, emberShare: null });
    expect(frictionSplit([session(), session()]).emberShare).toBeNull();
  });

  it("sums across sessions", () => {
    const result = frictionSplit([
      session({ minutes: 60, events: [{ type: "productive_struggle", intensity: 3 }] }),
      session({ minutes: 30, events: [{ type: "tooling", intensity: 3 }] }),
      session({ minutes: 90 }),
    ]);
    expect(result).toEqual({ emberMinutes: 60, slagMinutes: 30, emberShare: 60 / 90 });
  });

  it("is not skewed by a frictionless session, however long", () => {
    // The invariant that makes the ratio mean something: a five-hour session with nothing logged
    // must not dilute the share of the twenty minutes that were examined.
    const withFriction = session({
      minutes: 20,
      events: [{ type: "productive_struggle", intensity: 3 }],
    });
    expect(frictionSplit([withFriction]).emberShare).toBe(1);
    expect(frictionSplit([withFriction, session({ minutes: 300 })]).emberShare).toBe(1);
  });
});

describe("emberShare", () => {
  it("is null when there is nothing to divide", () => {
    expect(emberShare(0, 0)).toBeNull();
  });

  it("is the productive fraction otherwise", () => {
    expect(emberShare(30, 10)).toBe(0.75);
    expect(emberShare(0, 10)).toBe(0);
    expect(emberShare(10, 0)).toBe(1);
  });
});
