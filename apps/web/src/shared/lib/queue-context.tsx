import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/http.js";
import {
  idbStorageFor,
  OfflineQueue,
  startAutoFlush,
  type QueuedRequest,
  type QueueStorage,
} from "./offline-queue.js";

interface QueueValue {
  readonly queue: OfflineQueue;
  /** Surfaced so the shell can say "3 captures waiting" rather than pretending all is well. */
  readonly pending: number;
  readonly dropped: number;
}

const QueueContext = createContext<QueueValue | null>(null);

/**
 * One queue per user, provided rather than imported as a singleton.
 *
 * A module-level instance would be simpler and untestable: every test would share one queue and
 * one IndexedDB key, so a leftover entry from one test would flush during another.
 */
interface OfflineQueueProviderProps {
  readonly children: ReactNode;
  /**
   * Whose captures these are. Absent while signed out, and absent is not a default — see below.
   *
   * IndexedDB is per-origin rather than per-account, so the storage key has to carry this or the
   * device has one queue: sign out with unsent captures, sign in as somebody else, and the next
   * flush replays them under the new user's token.
   */
  readonly userId?: string | undefined;
  /**
   * Overridden in tests. IndexedDB in jsdom needs a polyfill, and more importantly a test that
   * can *read* the queue asserts what was enqueued rather than inferring it from behaviour —
   * which is the difference between checking the rule and checking a symptom.
   */
  readonly storage?: QueueStorage;
}

export function OfflineQueueProvider({ children, userId, storage }: OfflineQueueProviderProps) {
  const [pending, setPending] = useState(0);
  const [dropped, setDropped] = useState(0);

  /**
   * No user, no storage, no queue — rather than a queue over some shared fallback key.
   *
   * Nothing signed out can capture anything, so there is nothing to hold; and a fallback key is how
   * the unscoped bug would come back, since whatever landed in it has no owner and cannot be
   * replayed into an account safely. `useOfflineQueue` already returns null for the tests that never
   * opted into a queue, and the capture hooks degrade the same way here: a failed request is just a
   * failed request.
   */
  const resolved = useMemo(
    () => storage ?? (userId === undefined ? null : idbStorageFor(userId)),
    [storage, userId],
  );

  const queue = useMemo(
    () =>
      resolved === null
        ? null
        : new OfflineQueue({
            storage: resolved,
            // The queue is handed `send` rather than importing the http client, so it does not depend
            // on auth — and so a test can drive it without a token.
            send: (path, body, method) =>
              method === "PATCH" ? api.replay(path, body, "PATCH") : api.replay(path, body),
            onChange: setPending,
            onDropped: (request: QueuedRequest) => {
              setDropped((count) => count + 1);
              // Reported, never swallowed: a dropped capture is data loss, and the one thing this
              // product cannot do is quietly lose the data it exists to collect.
              console.error("Dropped a queued capture", request.key, request.path);
            },
          }),
    [resolved],
  );

  useEffect(() => {
    if (queue === null) {
      // So a sign-out does not leave the previous user's count on screen.
      setPending(0);
      setDropped(0);
      return;
    }
    void queue.pending().then(setPending);
    return startAutoFlush(queue);
  }, [queue]);

  const value = useMemo(
    () => (queue === null ? null : { queue, pending, dropped }),
    [queue, pending, dropped],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

/**
 * Null outside the provider rather than throwing.
 *
 * The capture hooks degrade to "no queue, so a failed request is just a failed request", which is
 * the correct behaviour in a unit test that did not opt into one — and much better than every
 * component test needing a provider it does not care about. It is also what a signed-out app gets,
 * which is the same answer for the same reason: there is no account to file a capture under.
 */
export function useOfflineQueue(): QueueValue | null {
  return useContext(QueueContext);
}
