import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/http.js";
import {
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
 * One queue for the app, provided rather than imported as a singleton.
 *
 * A module-level instance would be simpler and untestable: every test would share one queue and
 * one IndexedDB key, so a leftover entry from one test would flush during another.
 */
interface OfflineQueueProviderProps {
  readonly children: ReactNode;
  /**
   * Overridden in tests. IndexedDB in jsdom needs a polyfill, and more importantly a test that
   * can *read* the queue asserts what was enqueued rather than inferring it from behaviour —
   * which is the difference between checking the rule and checking a symptom.
   */
  readonly storage?: QueueStorage;
}

export function OfflineQueueProvider({ children, storage }: OfflineQueueProviderProps) {
  const [pending, setPending] = useState(0);
  const [dropped, setDropped] = useState(0);

  const queue = useMemo(
    () =>
      new OfflineQueue({
        ...(storage ? { storage } : {}),
        // The queue is handed `send` rather than importing the http client, so it does not depend
        // on auth — and so a test can drive it without a token.
        send: (path, body, method) =>
          method === "PATCH" ? api.patch(path, body) : api.post(path, body),
        onChange: setPending,
        onDropped: (request: QueuedRequest) => {
          setDropped((count) => count + 1);
          // Reported, never swallowed: a dropped capture is data loss, and the one thing this
          // product cannot do is quietly lose the data it exists to collect.
          console.error("Dropped a queued capture", request.key, request.path);
        },
      }),
    [storage],
  );

  useEffect(() => {
    void queue.pending().then(setPending);
    return startAutoFlush(queue);
  }, [queue]);

  const value = useMemo(() => ({ queue, pending, dropped }), [queue, pending, dropped]);

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

/**
 * Null outside the provider rather than throwing.
 *
 * The capture hooks degrade to "no queue, so a failed request is just a failed request", which is
 * the correct behaviour in a unit test that did not opt into one — and much better than every
 * component test needing a provider it does not care about.
 */
export function useOfflineQueue(): QueueValue | null {
  return useContext(QueueContext);
}
