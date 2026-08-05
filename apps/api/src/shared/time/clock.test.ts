import { describe, expect, it } from "vitest";
import { FixedClock, SystemClock } from "./clock.js";

describe("SystemClock", () => {
  it("reads the wall clock", () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe("FixedClock", () => {
  it("does not move on its own", () => {
    const clock = new FixedClock(new Date("2026-08-05T12:00:00Z"));
    expect(clock.now().toISOString()).toBe("2026-08-05T12:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-08-05T12:00:00.000Z");
  });

  it("hands out a copy, so a caller cannot mutate the clock through it", () => {
    // Date is mutable. A use case doing `now.setHours(0,0,0,0)` to find the start
    // of a day would otherwise rewind the clock for every later assertion in the
    // same test — and the test would fail somewhere unrelated.
    const clock = new FixedClock(new Date("2026-08-05T12:00:00Z"));
    const handed = clock.now();
    handed.setFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it("advances by an interval", () => {
    const clock = new FixedClock(new Date("2026-08-05T12:00:00Z"));
    clock.advance(90 * 60 * 1000);
    expect(clock.now().toISOString()).toBe("2026-08-05T13:30:00.000Z");
  });

  it("jumps to an instant", () => {
    const clock = new FixedClock(new Date("2026-08-05T12:00:00Z"));
    clock.set(new Date("2027-01-01T00:00:00Z"));
    expect(clock.now().toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
