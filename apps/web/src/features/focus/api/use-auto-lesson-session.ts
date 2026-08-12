import { useEffect, useRef, useState } from "react";

import { now } from "../../../shared/lib/clock.js";
import { useRunningSession, useStartSession, useStopSession } from "./use-focus.js";

/**
 * Time a lesson while it is open, without anyone pressing start (FR-F5).
 *
 * Opening a lesson is activity, and until this existed a lesson read without the timer
 * rendered on the grid as a rest day. What it records is a real elapsed duration rather
 * than an invented one — non-negotiable 10 rules out crediting a click with minutes —
 * and it records it as `entryMode: "auto"` so that "time the reader was open" and "time
 * I declared I was focusing" stay two populations rather than one.
 *
 * **The app cannot see reading.** The lesson is a cross-origin sandboxed frame, so a
 * scroll or a keystroke inside it is invisible here (§7.5, and that isolation is not
 * negotiable). Everything below is therefore about bounding a measurement that cannot be
 * confirmed:
 *
 * - **Hidden tab ends the session**, after a grace period. Switching away for ten seconds
 *   to look something up should not chop a read into two rows; being gone for a minute
 *   is not reading.
 * - **A cap ends it too.** A visible tab you walked away from is indistinguishable from
 *   one you are reading, and the only honest response to that is to stop counting. Beyond
 *   the cap the manual button is still there, and a block you press start for is a claim
 *   you made rather than one the app made for you.
 * - **It only ever stops its own session.** A timer you started deliberately is never
 *   touched, which is why the id it started is held rather than "whatever is running".
 */

/**
 * How long an unattended reader keeps counting.
 *
 * Longer than the lessons the `teach` skill is told to write — short, one tangible win —
 * and short enough that a tab left open over lunch does not become an hour of focus. It
 * is a ceiling on a guess, not a target.
 */
export const AUTO_MAX_MINUTES = 45;

/**
 * How long a hidden tab keeps counting before the session is ended.
 *
 * Not zero: `visibilitychange` fires for a ⌘-Tab to check a definition, and ending on
 * every one of those would turn one read into a dozen rows of forty seconds each.
 */
const HIDDEN_GRACE_MS = 60_000;

/**
 * How long the reader must stay open before a session is started at all.
 *
 * Opening a lesson and going straight back is not a read, and starting on the mount
 * recorded it as one — a row of a few hundred milliseconds, worth zero minutes and
 * cluttering the history the debrief and the library page list. It also doubled every
 * open in development, where React mounts, unmounts and remounts each effect: the first
 * mount started a session, the cleanup stopped it, and the second started another.
 *
 * Short enough to be invisible to someone who meant to open the lesson.
 */
export const SETTLE_MS = 2_000;

/**
 * A session left running by a closed tab is stale once it passes the cap.
 *
 * `at` is passed rather than read, through the one browser seam that reads the wall
 * clock — the same rule the rest of the product follows, and what lets this be tested
 * at a fixed instant rather than by waiting 45 minutes.
 */
function isAbandoned(startedAt: string, at: Date): boolean {
  return at.getTime() - new Date(startedAt).getTime() > AUTO_MAX_MINUTES * 60_000;
}

export function useAutoLessonSession(lessonId: string, enabled: boolean): void {
  const running = useRunningSession(enabled);
  const start = useStartSession();
  const stop = useStopSession();

  /**
   * The mutations are reached through a ref rather than named as effect dependencies.
   *
   * TanStack returns a new mutation object on every render, so naming them would tear the
   * listeners down and re-run this on each one — which for an effect whose cleanup ends a
   * session is a start/stop loop, not a re-subscribe.
   */
  const mutations = useRef({ start, stop });
  mutations.current = { start, stop };

  /** The session this hook started, or null. Never anything it merely found running. */
  const owned = useRef<string | null>(null);
  /**
   * The start that is still in flight, resolving to whether a session now exists.
   *
   * Held because leaving immediately is a normal thing to do — open a lesson, decide it
   * is not the one, go back — and the stop would otherwise be sent before the start
   * landed. That is a 404 on a session that then exists and runs forever, and every
   * later start answers 409 until the reaper's cap passes. Seen in the E2E logs before
   * it was seen anywhere else.
   */
  const inflight = useRef<Promise<boolean> | null>(null);
  /** Set when the cap fires, so the reader does not immediately start counting again. */
  const capped = useRef(false);
  /** Bumped to ask for another attempt after the tab comes back into view. */
  const [attempt, setAttempt] = useState(0);

  const session = running.data?.session ?? null;
  const idle = enabled && running.isSuccess && session === null;

  /**
   * Reap a session a closed tab left running.
   *
   * `pagehide` cannot be relied on to complete a POST, so the honest fallback is to clean
   * up on the way in rather than to pretend the way out is reliable. Only `auto` sessions,
   * and only past the cap: a timer you started and left running deliberately is yours, and
   * a running session is worth 0 minutes to the rollup either way — what it actually costs
   * you is the 409 on the next start.
   */
  useEffect(() => {
    if (!enabled || session === null || !session.isRunning) return;
    if (session.entryMode !== "auto" || owned.current === session.id) return;
    if (!isAbandoned(session.startedAt, now())) return;

    mutations.current.stop.mutate({ id: session.id });
  }, [enabled, session]);

  /**
   * Starting, once the reader has stayed open for `SETTLE_MS`.
   *
   * The cleanup cancels the pending start and nothing else. Ending a *started* session is
   * the other effect's job — doing it here would fire whenever `idle` flipped, which it
   * does the moment a start succeeds.
   */
  useEffect(() => {
    if (!idle || capped.current || owned.current !== null) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    const settle = setTimeout(() => {
      const id = crypto.randomUUID();
      owned.current = id;
      inflight.current = mutations.current.start
        .mutateAsync({ id, lessonId, entryMode: "auto" })
        .then(() => true)
        .catch(() => {
          // A refused start — most likely a 409 for a session started on another device
          // between the running read and this write. Disowning it is what stops the
          // cleanup from later issuing a stop for a session that was never created.
          if (owned.current === id) owned.current = null;
          return false;
        });
    }, SETTLE_MS);

    return () => clearTimeout(settle);
  }, [idle, lessonId, attempt]);

  // Ending: the cap, the hidden tab, and leaving the page.
  useEffect(() => {
    if (!enabled) return;

    let hiding: ReturnType<typeof setTimeout> | null = null;

    const end = (): void => {
      const id = owned.current;
      if (id === null) return;
      owned.current = null;

      // Sequenced behind the start rather than fired beside it, and skipped entirely if
      // that start never produced a session. The mutation outlives this component — it
      // belongs to the query client — so a stop issued after unmount still sends.
      const started = inflight.current ?? Promise.resolve(true);
      inflight.current = null;
      void started.then((exists) => {
        if (exists) mutations.current.stop.mutate({ id });
      });
    };

    const cap = setTimeout(() => {
      capped.current = true;
      end();
    }, AUTO_MAX_MINUTES * 60_000);

    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") {
        hiding = setTimeout(end, HIDDEN_GRACE_MS);
        return;
      }
      if (hiding !== null) {
        clearTimeout(hiding);
        hiding = null;
      }
      // The session may have been ended while away, and a ref change alone would not
      // re-run the effect that starts one.
      if (!capped.current && owned.current === null) setAttempt((n) => n + 1);
    };

    document.addEventListener("visibilitychange", onVisibility);
    // Best effort only — see the reaper above for what actually covers a closed tab.
    window.addEventListener("pagehide", end);

    return () => {
      clearTimeout(cap);
      if (hiding !== null) clearTimeout(hiding);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", end);
      end();
    };
  }, [enabled, lessonId]);

  // A different lesson is a different measurement, so the cap does not carry across.
  useEffect(() => {
    capped.current = false;
  }, [lessonId]);
}
