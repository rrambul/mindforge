import { describe, expect, it } from "vitest";
import { detectStalls, type StallCandidate } from "./stall.js";

const TODAY = "2026-08-07";

function candidate(partial: Partial<StallCandidate> & { missionId: string }): StallCandidate {
  return { createdOn: "2026-01-01", lastSessionOn: null, ...partial };
}

describe("detectStalls", () => {
  it("finds nothing among missions worked on recently", () => {
    expect(
      detectStalls([candidate({ missionId: "m1", lastSessionOn: "2026-08-05" })], { today: TODAY }),
    ).toEqual([]);
  });

  it("finds a mission quiet for longer than the threshold", () => {
    const [stall] = detectStalls([candidate({ missionId: "m1", lastSessionOn: "2026-07-01" })], {
      today: TODAY,
    });
    expect(stall).toMatchObject({
      missionId: "m1",
      untouchedDays: 37,
      lastSessionOn: "2026-07-01",
    });
  });

  it("fires exactly on the threshold, not a day later", () => {
    const twelveDaysAgo = candidate({ missionId: "m1", lastSessionOn: "2026-07-26" });
    const elevenDaysAgo = candidate({ missionId: "m2", lastSessionOn: "2026-07-27" });
    expect(detectStalls([twelveDaysAgo], { today: TODAY })).toHaveLength(1);
    expect(detectStalls([elevenDaysAgo], { today: TODAY })).toHaveLength(0);
  });

  it("counts a never-worked mission from the day it was created", () => {
    // Started with enthusiasm and never opened again is the case the nudge is for. Measuring from
    // "last session" alone would make it the one case that never fires.
    const [stall] = detectStalls([candidate({ missionId: "m1", createdOn: "2026-07-01" })], {
      today: TODAY,
    });
    expect(stall).toMatchObject({ untouchedDays: 37, lastSessionOn: null });
  });

  it("does not call a mission stalled on the strength of a future-dated session", () => {
    // Retroactive entry lets a session be logged for tomorrow by mistake, and a negative age must
    // not wrap around into a stall.
    expect(
      detectStalls([candidate({ missionId: "m1", lastSessionOn: "2026-09-01" })], { today: TODAY }),
    ).toEqual([]);
  });

  it("honours a configured threshold", () => {
    const quiet = [candidate({ missionId: "m1", lastSessionOn: "2026-08-01" })];
    expect(detectStalls(quiet, { today: TODAY })).toHaveLength(0);
    expect(detectStalls(quiet, { today: TODAY, afterDays: 5 })).toHaveLength(1);
  });

  it("orders by how long each has been quiet, then by id", () => {
    const stalls = detectStalls(
      [
        candidate({ missionId: "b", lastSessionOn: "2026-07-01" }),
        candidate({ missionId: "a", lastSessionOn: "2026-06-01" }),
        candidate({ missionId: "a2", lastSessionOn: "2026-07-01" }),
      ],
      { today: TODAY },
    );
    expect(stalls.map((s) => s.missionId)).toEqual(["a", "a2", "b"]);
  });

  describe("dedupeKey", () => {
    it("is the same all week, so a month of silence asks once a week rather than thirty times", () => {
      const quiet = [candidate({ missionId: "m1", lastSessionOn: "2026-01-01" })];
      const monday = detectStalls(quiet, { today: "2026-08-03" })[0]!.dedupeKey;
      const sunday = detectStalls(quiet, { today: "2026-08-09" })[0]!.dedupeKey;
      expect(monday).toBe(sunday);
    });

    it("changes the following week", () => {
      const quiet = [candidate({ missionId: "m1", lastSessionOn: "2026-01-01" })];
      const thisWeek = detectStalls(quiet, { today: "2026-08-09" })[0]!.dedupeKey;
      const nextWeek = detectStalls(quiet, { today: "2026-08-10" })[0]!.dedupeKey;
      expect(thisWeek).not.toBe(nextWeek);
    });

    it("is distinct per mission", () => {
      const stalls = detectStalls(
        [
          candidate({ missionId: "m1", lastSessionOn: "2026-01-01" }),
          candidate({ missionId: "m2", lastSessionOn: "2026-01-01" }),
        ],
        { today: TODAY },
      );
      expect(new Set(stalls.map((s) => s.dedupeKey)).size).toBe(2);
    });
  });
});
