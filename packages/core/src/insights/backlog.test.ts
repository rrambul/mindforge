import { describe, expect, it } from "vitest";
import { backlogHealth, type BacklogResource } from "./backlog.js";

const TODAY = "2026-08-07";

function resource(partial: Partial<BacklogResource> & { id: string }): BacklogResource {
  return {
    status: "queued",
    addedOn: TODAY,
    resolvedOn: null,
    abandonReason: null,
    lastTouchedOn: null,
    ...partial,
  };
}

describe("backlogHealth", () => {
  it("reports nulls rather than zeroes for an empty library", () => {
    // A brand-new account has not got a zero-day-old backlog and a 0% abandonment rate. It has no
    // backlog, which is a different statement.
    const health = backlogHealth([], { today: TODAY });
    expect(health.openCount).toBe(0);
    expect(health.oldestOpenDays).toBeNull();
    expect(health.medianOpenAgeDays).toBeNull();
    expect(health.abandonmentRate).toBeNull();
    expect(health.signal).toBeNull();
  });

  it("counts additions and resolutions inside the window only", () => {
    const health = backlogHealth(
      [
        resource({ id: "in", addedOn: "2026-07-11" }),
        resource({ id: "out", addedOn: "2026-07-10" }),
        resource({
          id: "finished",
          status: "finished",
          addedOn: "2026-01-01",
          resolvedOn: "2026-08-01",
        }),
        resource({
          id: "finished-long-ago",
          status: "finished",
          addedOn: "2026-01-01",
          resolvedOn: "2026-06-01",
        }),
      ],
      { today: TODAY },
    );
    expect(health.added).toBe(1);
    expect(health.resolved).toBe(1);
    expect(health.netChange).toBe(0);
  });

  it("treats reference material as neither open nor resolved", () => {
    // A reference resource is a thing you keep, not a thing you owe yourself. Counting it as
    // backlog would make a well-organised library look like debt.
    const health = backlogHealth([resource({ id: "docs", status: "reference" })], { today: TODAY });
    expect(health.openCount).toBe(0);
    expect(health.resolved).toBe(0);
  });

  it("ages open items from the day they were added, however far back that is", () => {
    // Clipping to the window would hide exactly the item worth seeing.
    const health = backlogHealth(
      [
        resource({ id: "old", status: "inbox", addedOn: "2025-08-07" }),
        resource({ id: "new", status: "queued", addedOn: "2026-08-01" }),
      ],
      { today: TODAY },
    );
    expect(health.openCount).toBe(2);
    expect(health.oldestOpenDays).toBe(365);
    expect(health.medianOpenAgeDays).toBe((365 + 6) / 2);
  });

  it("takes the middle value as the median for an odd count", () => {
    const health = backlogHealth(
      [
        resource({ id: "a", addedOn: "2026-08-06" }),
        resource({ id: "b", addedOn: "2026-08-04" }),
        resource({ id: "c", addedOn: "2026-08-01" }),
      ],
      { today: TODAY },
    );
    expect(health.medianOpenAgeDays).toBe(3);
  });

  it("splits resolutions into finished and abandoned by the reason", () => {
    const health = backlogHealth(
      [
        resource({ id: "f", status: "finished", resolvedOn: "2026-08-05" }),
        resource({
          id: "a1",
          status: "abandoned",
          resolvedOn: "2026-08-05",
          abandonReason: "too_shallow",
        }),
        resource({
          id: "a2",
          status: "abandoned",
          resolvedOn: "2026-08-06",
          abandonReason: "too_shallow",
        }),
        resource({
          id: "a3",
          status: "abandoned",
          resolvedOn: "2026-08-06",
          abandonReason: "no_longer_relevant",
        }),
      ],
      { today: TODAY },
    );
    expect(health.finished).toBe(1);
    expect(health.abandoned).toBe(3);
    expect(health.abandonmentRate).toBe(0.75);
    expect(health.abandonReasons).toEqual([
      { reason: "too_shallow", count: 2 },
      { reason: "no_longer_relevant", count: 1 },
    ]);
  });

  it("calls an active item stalled once it has gone untouched long enough", () => {
    const health = backlogHealth(
      [
        resource({ id: "reading", status: "active", lastTouchedOn: "2026-08-06" }),
        resource({
          id: "stalled",
          status: "active",
          addedOn: "2026-05-01",
          lastTouchedOn: "2026-07-01",
        }),
      ],
      { today: TODAY },
    );
    expect(health.stalled).toEqual([
      { id: "stalled", untouchedDays: 37, lastTouchedOn: "2026-07-01" },
    ]);
  });

  it("counts a never-touched active item from the day it was added", () => {
    // Otherwise the items most in need of a decision — started with enthusiasm, never opened —
    // are the only ones that never surface.
    const health = backlogHealth(
      [resource({ id: "never", status: "active", addedOn: "2026-06-01" })],
      { today: TODAY },
    );
    expect(health.stalled[0]).toEqual({
      id: "never",
      untouchedDays: 67,
      lastTouchedOn: null,
    });
  });

  it("does not call a queued item stalled", () => {
    // Stalled means started and then dropped. Something you have not begun is a queue, not a stall,
    // and conflating the two makes the signal fire on every wish-list.
    const health = backlogHealth(
      [resource({ id: "someday", status: "queued", addedOn: "2025-01-01" })],
      { today: TODAY },
    );
    expect(health.stalled).toEqual([]);
  });

  it("honours a custom stall threshold", () => {
    const one = [resource({ id: "x", status: "active", lastTouchedOn: "2026-08-01" })];
    expect(backlogHealth(one, { today: TODAY }).stalled).toHaveLength(0);
    expect(backlogHealth(one, { today: TODAY, stalledAfterDays: 5 }).stalled).toHaveLength(1);
  });

  it("honours a custom window", () => {
    const items = [resource({ id: "x", addedOn: "2026-08-01" })];
    expect(backlogHealth(items, { today: TODAY, windowDays: 7 }).added).toBe(1);
    expect(backlogHealth(items, { today: TODAY, windowDays: 3 }).added).toBe(0);
  });

  it("orders stalled items by how long they have been quiet", () => {
    const health = backlogHealth(
      [
        resource({ id: "b", status: "active", lastTouchedOn: "2026-07-01" }),
        resource({ id: "a", status: "active", lastTouchedOn: "2026-06-01" }),
      ],
      { today: TODAY },
    );
    expect(health.stalled.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("breaks a tie on id so the same data never renders in two orders", () => {
    const health = backlogHealth(
      [
        resource({ id: "z", status: "active", lastTouchedOn: "2026-07-01" }),
        resource({ id: "a", status: "active", lastTouchedOn: "2026-07-01" }),
      ],
      { today: TODAY },
    );
    expect(health.stalled.map((s) => s.id)).toEqual(["a", "z"]);
  });

  describe("signal", () => {
    const stalledItem = (id: string) =>
      resource({ id, status: "active", lastTouchedOn: "2026-06-01" });

    it("names stalled items ahead of a growing queue", () => {
      // Deciding about three stalled books is a smaller act than reversing a month of growth.
      const health = backlogHealth(
        [
          stalledItem("a"),
          stalledItem("b"),
          stalledItem("c"),
          resource({ id: "1", addedOn: "2026-08-01" }),
          resource({ id: "2", addedOn: "2026-08-02" }),
          resource({ id: "3", addedOn: "2026-08-03" }),
        ],
        { today: TODAY },
      );
      expect(health.signal).toEqual({ kind: "stalling", count: 3, days: 21 });
    });

    it("stays quiet about two stalled items", () => {
      const health = backlogHealth([stalledItem("a"), stalledItem("b")], { today: TODAY });
      expect(health.signal).toBeNull();
    });

    it("names a queue growing faster than it clears", () => {
      const health = backlogHealth(
        [
          resource({ id: "1", addedOn: "2026-08-01" }),
          resource({ id: "2", addedOn: "2026-08-02" }),
          resource({ id: "3", addedOn: "2026-08-03" }),
        ],
        { today: TODAY },
      );
      expect(health.signal).toEqual({ kind: "growing", added: 3, resolved: 0 });
    });

    it("stays quiet when the queue grew by one", () => {
      // A line about a single book every month is how a user learns to stop reading the line.
      const health = backlogHealth(
        [
          resource({ id: "1", addedOn: "2026-08-01" }),
          resource({ id: "2", addedOn: "2026-08-02" }),
          resource({
            id: "f",
            status: "finished",
            addedOn: "2026-01-01",
            resolvedOn: "2026-08-03",
          }),
        ],
        { today: TODAY },
      );
      expect(health).toMatchObject({ added: 2, resolved: 1, netChange: 1 });
      expect(health.signal).toBeNull();
    });

    it("stays quiet when throughput keeps up", () => {
      const health = backlogHealth(
        [
          resource({ id: "1", addedOn: "2026-08-01" }),
          resource({ id: "2", addedOn: "2026-08-02" }),
          resource({ id: "3", addedOn: "2026-08-03" }),
          resource({
            id: "f1",
            status: "finished",
            addedOn: "2026-01-01",
            resolvedOn: "2026-08-04",
          }),
          resource({
            id: "f2",
            status: "finished",
            addedOn: "2026-01-01",
            resolvedOn: "2026-08-05",
          }),
        ],
        { today: TODAY },
      );
      expect(health).toMatchObject({ added: 3, resolved: 2, netChange: 1 });
      expect(health.signal).toBeNull();
    });

    it("counts an item added and finished in the same window on both sides", () => {
      // Net zero, which is the honest reading: you took something on and you finished it.
      const health = backlogHealth(
        [
          resource({
            id: "fast",
            status: "finished",
            addedOn: "2026-08-01",
            resolvedOn: "2026-08-05",
          }),
        ],
        { today: TODAY },
      );
      expect(health).toMatchObject({ added: 1, resolved: 1, netChange: 0 });
    });

    it("names a very old open item when nothing more urgent applies", () => {
      const health = backlogHealth(
        [resource({ id: "ancient", status: "inbox", addedOn: "2025-08-07" })],
        { today: TODAY },
      );
      expect(health.signal).toEqual({ kind: "aging", days: 365 });
    });

    it("stays quiet about an item that is merely old", () => {
      const health = backlogHealth(
        [resource({ id: "oldish", status: "inbox", addedOn: "2026-04-01" })],
        { today: TODAY },
      );
      expect(health.signal).toBeNull();
    });
  });
});
