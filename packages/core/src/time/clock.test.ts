import { describe, expect, it } from "vitest";
import { FixedClock, SystemClock } from "./clock.js";

describe("SystemClock", () => {
  it("reads the wall clock", () => {
    const before = Date.now();
    const read = new SystemClock().now().getTime();
    const after = Date.now();

    expect(read).toBeGreaterThanOrEqual(before);
    expect(read).toBeLessThanOrEqual(after);
  });
});

describe("FixedClock", () => {
  it("does not move on its own", () => {
    const clock = new FixedClock(new Date("2026-08-07T09:00:00Z"));
    expect(clock.now().toISOString()).toBe("2026-08-07T09:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-08-07T09:00:00.000Z");
  });

  it("moves when set or advanced", () => {
    const clock = new FixedClock(new Date("2026-08-07T09:00:00Z"));

    clock.advance(90 * 60 * 1000);
    expect(clock.now().toISOString()).toBe("2026-08-07T10:30:00.000Z");

    clock.set(new Date("2027-01-01T00:00:00Z"));
    expect(clock.now().toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("hands out a copy, so a caller cannot move everyone else's clock", () => {
    // A Date is mutable. Returning the field itself means one test's `setHours` silently changes
    // what every later assertion is comparing against, and the failure surfaces somewhere else.
    const clock = new FixedClock(new Date("2026-08-07T09:00:00Z"));
    clock.now().setUTCFullYear(1999);
    expect(clock.now().toISOString()).toBe("2026-08-07T09:00:00.000Z");
  });
});
