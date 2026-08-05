import { useEffect, useState } from "react";

/**
 * Elapsed minutes and seconds since an instant, ticking locally.
 *
 * Local rather than server-rendered because a running session's elapsed time is a function of
 * *now*: any figure the server sent would be stale by the time it painted. The API withholds
 * `minutes` for a running session for exactly this reason.
 *
 * Ticks once a second and derives the display from the wall clock each time rather than
 * incrementing a counter. A counter drifts — a backgrounded tab throttles its timers, and after
 * an hour minimised the session would claim to be minutes shorter than it is.
 */
export function useElapsed(startedAt: string | null): { minutes: number; seconds: number } {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;

    // Re-read on wake as well as on tick: returning to a throttled tab should correct
    // immediately rather than at the next second boundary.
    const onVisible = (): void => setNow(Date.now());
    const interval = setInterval(onVisible, 1_000);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [startedAt]);

  if (startedAt === null) return { minutes: 0, seconds: 0 };

  // Never negative: a session started by a device whose clock is ahead would otherwise count
  // down, which reads as broken rather than as a clock problem.
  const elapsedMs = Math.max(0, now - new Date(startedAt).getTime());
  const totalSeconds = Math.floor(elapsedMs / 1_000);

  return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}

/** `42:07`. Mono and tabular at the call site, so the digits do not jitter as they change. */
export function formatElapsed(minutes: number, seconds: number): string {
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
