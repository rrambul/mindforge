import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatElapsed, useElapsed } from "./use-elapsed.js";

const NOW = new Date("2026-08-05T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe("useElapsed", () => {
  it("reports the time since the session started", () => {
    const { result } = renderHook(() => useElapsed(minutesAgo(42)));
    expect(result.current).toEqual({ minutes: 42, seconds: 0 });
  });

  it("ticks", () => {
    const { result } = renderHook(() => useElapsed(minutesAgo(0)));

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.seconds).toBe(3);
  });

  it("derives from the wall clock rather than counting its own ticks", () => {
    // A backgrounded tab throttles timers. Incrementing a counter would make the session claim
    // to be minutes shorter than it is after an hour minimised; re-reading the clock cannot.
    const { result } = renderHook(() => useElapsed(minutesAgo(10)));

    // One tick fires, but an hour of wall time has passed.
    act(() => {
      vi.setSystemTime(new Date(NOW.getTime() + 60 * 60_000));
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.minutes).toBe(70);
  });

  it("corrects immediately when the tab becomes visible again", () => {
    const { result } = renderHook(() => useElapsed(minutesAgo(10)));

    act(() => {
      vi.setSystemTime(new Date(NOW.getTime() + 30 * 60_000));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Without the listener this would wait for the next second boundary, which on a throttled
    // tab can be much later than a second.
    expect(result.current.minutes).toBe(40);
  });

  it("stays at zero with nothing running, and starts no timer", () => {
    const { result } = renderHook(() => useElapsed(null));
    expect(result.current).toEqual({ minutes: 0, seconds: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never counts down when the start is in the future", () => {
    // A session started by a device whose clock is ahead. Counting down reads as broken rather
    // than as a clock problem.
    const { result } = renderHook(() => useElapsed(new Date(NOW.getTime() + 60_000).toISOString()));
    expect(result.current).toEqual({ minutes: 0, seconds: 0 });
  });

  it("stops ticking when unmounted", () => {
    const { unmount } = renderHook(() => useElapsed(minutesAgo(1)));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("formatElapsed", () => {
  it("pads the seconds so the width does not jump", () => {
    // Paired with tabular figures: an unpadded 42:7 would shift the whole line each tick.
    expect(formatElapsed(42, 7)).toBe("42:07");
    expect(formatElapsed(0, 0)).toBe("0:00");
  });

  it("counts minutes past an hour rather than rolling over", () => {
    // A focus block is measured in minutes; "90:00" is more directly comparable to a planned
    // 90 minutes than "1:30:00" would be.
    expect(formatElapsed(90, 5)).toBe("90:05");
  });
});
