import { del, get, set } from "idb-keyval";
import { ApiError, NetworkError } from "../api/problem.js";
import { nowIso } from "./clock.js";

/**
 * The offline queue for the capture paths (§5, §6.1).
 *
 * Lives in `shared/lib`, not in a feature, because the three capture paths — session
 * start/stop, friction, resource progress — all need it and none of them owns it.
 *
 * It exists for one specific case that §5 calls the realistic one: you log friction on the
 * subway. Losing that event does not merely lose a row, it kills trust in the data — and a
 * friction number you do not trust is worse than no friction number, because you would still
 * act on it.
 *
 * What makes this safe rather than a source of duplicates is entirely upstream: every capture
 * endpoint is an idempotent upsert on a client-minted UUID, proven in
 * `apps/api/test/capture-loop.test.ts`. So replaying blindly is correct, and the client never
 * has to reason about whether its first attempt landed.
 */

export interface QueuedRequest {
  /**
   * Identity of the *operation*, not of the request — `friction:<uuid>`,
   * `focus:start:<uuid>`, `focus:stop:<uuid>`.
   *
   * Enqueuing the same key twice replaces rather than appends: two taps of Stop on the same
   * session are one operation, and the server would converge on the same row anyway.
   */
  readonly key: string;
  readonly path: string;
  readonly body: unknown;
  /**
   * Absent on everything queued before progress updates existed, which is why it is optional and
   * why `send` defaults it. A stored queue survives a deploy, so a required field here would make
   * every already-queued capture unreplayable — losing exactly the data this class exists to keep.
   */
  readonly method?: QueuedMethod;
  readonly queuedAt: string;
  readonly attempts: number;
}

/**
 * Only the two verbs a capture uses.
 *
 * Not `string`: a queue that can replay a DELETE is a queue that can silently destroy something on
 * reconnect, and no capture path needs one.
 */
export type QueuedMethod = "POST" | "PATCH";

/**
 * The persistence seam.
 *
 * An interface rather than idb-keyval directly, for the same reason `Clock` is a port: it makes
 * the queue's ordering and drop rules testable without a fake IndexedDB, and those rules are
 * the part that can actually be wrong.
 */
export interface QueueStorage {
  read(): Promise<QueuedRequest[]>;
  write(requests: QueuedRequest[]): Promise<void>;
  clear(): Promise<void>;
}

const STORAGE_KEY = "mindforge.offline-queue";

export const idbStorage: QueueStorage = {
  async read() {
    return (await get<QueuedRequest[]>(STORAGE_KEY)) ?? [];
  },
  async write(requests) {
    await set(STORAGE_KEY, requests);
  },
  async clear() {
    await del(STORAGE_KEY);
  },
};

/** What a flush attempt does with one request. */
export type Disposition = "sent" | "retry" | "dropped";

export interface FlushResult {
  readonly sent: number;
  readonly dropped: number;
  readonly remaining: number;
}

/**
 * Give up after this many attempts.
 *
 * Not unbounded: a request that has failed twenty times is not going to succeed, and an
 * ever-growing queue would retry it on every reconnect forever — spending battery to
 * accomplish nothing and delaying the requests behind it.
 */
const MAX_ATTEMPTS = 8;

/**
 * Whether a failure is worth retrying.
 *
 * A 4xx is the request's own fault and will fail identically forever — a 422 body does not
 * become valid by waiting. Two exceptions: 401 means the token expired and the SDK will have
 * refreshed it by the next flush, and 429 means slow down rather than stop.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (!(error instanceof ApiError)) return false;
  if (error.status === 401 || error.status === 408 || error.status === 429) return true;
  return error.status >= 500;
}

export interface OfflineQueueOptions {
  readonly storage?: QueueStorage;
  /** Injected so the queue does not depend on the http client, which depends on auth. */
  readonly send: (path: string, body: unknown, method: QueuedMethod) => Promise<unknown>;
  readonly onChange?: (pending: number) => void;
  /** Reported rather than swallowed — a dropped capture is data loss and must be visible. */
  readonly onDropped?: (request: QueuedRequest, error: unknown) => void;
}

export class OfflineQueue {
  private readonly storage: QueueStorage;
  private flushing = false;

  /**
   * Every read-modify-write of the stored queue runs one at a time, chained through this.
   *
   * Without it `enqueue` is a read, an `await`, and a write — so two taps close together both read
   * the same array and the second write erases the first. All six call sites are `void queue.enqueue(…)`,
   * so nothing awaited the previous one, and the loss was silent: `onDropped` is for a request the
   * server refused, and this capture never became a request at all. Two friction chips tapped
   * offline in the same second was enough, which is exactly what tapping friction looks like.
   *
   * The network is deliberately *outside* the chain: `flush` awaits a request per entry, and holding
   * the lock across that would block every capture for the length of a bad connection — turning a
   * data-loss bug into a ≤5s-budget one.
   */
  private storageLock: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: OfflineQueueOptions) {
    this.storage = options.storage ?? idbStorage;
  }

  async pending(): Promise<number> {
    return (await this.storage.read()).length;
  }

  async enqueue(
    key: string,
    path: string,
    body: unknown,
    method: QueuedMethod = "POST",
  ): Promise<void> {
    return this.serialise(() => this.enqueueLocked(key, path, body, method));
  }

  private async enqueueLocked(
    key: string,
    path: string,
    body: unknown,
    method: QueuedMethod,
  ): Promise<void> {
    const queue = await this.storage.read();
    const entry: QueuedRequest = { key, path, body, method, queuedAt: nowIso(), attempts: 0 };

    const existing = queue.findIndex((request) => request.key === key);
    if (existing === -1) {
      queue.push(entry);
    } else {
      // Replaced in place, keeping its position: order is what makes a stop replay after its
      // start, and moving the entry to the back would invert them.
      queue[existing] = { ...entry, attempts: queue[existing]?.attempts ?? 0 };
    }

    await this.storage.write(queue);
    this.options.onChange?.(queue.length);
  }

  /**
   * Replays in order, stopping at the first retryable failure.
   *
   * Stopping rather than skipping ahead is the important part: `focus:stop` must not reach the
   * server before `focus:start`, or the stop 404s and the session stays open forever. FIFO with
   * a hard stop preserves that without the queue needing to know what any request means.
   */
  async flush(): Promise<FlushResult> {
    // A second flush while one is in progress would send everything twice. Harmless given the
    // upserts, but it doubles the traffic on a connection that just proved itself unreliable.
    if (this.flushing) return { sent: 0, dropped: 0, remaining: await this.pending() };
    this.flushing = true;

    try {
      const queue = await this.storage.read();
      let sent = 0;
      let dropped = 0;
      let index = 0;

      // What this pass finished with, identified by key *and* `queuedAt`. Recorded rather than
      // reconstructed from an index, because the stored queue is re-read below — see the note there.
      const settled = new Set<string>();
      let retried: QueuedRequest | null = null;

      for (; index < queue.length; index += 1) {
        const request = queue[index]!;
        const disposition = await this.attempt(request);

        if (disposition === "sent") {
          sent += 1;
          settled.add(identify(request));
          continue;
        }
        if (disposition === "dropped") {
          dropped += 1;
          settled.add(identify(request));
          continue;
        }

        // Retryable: keep this one and everything behind it, with the attempt counted.
        retried = { ...request, attempts: request.attempts + 1 };
        break;
      }

      /**
       * Re-read rather than writing back the snapshot this pass started from.
       *
       * Every `attempt` above awaits the network, and `enqueue` runs during that — you tap a friction
       * chip while a flush is in flight, which on a bad connection is the *normal* case rather than a
       * race worth ignoring. Writing back the old array silently discarded that event, and
       * `storage.clear()` on a fully-drained snapshot wiped it outright. `onDropped` never fired, so it
       * was invisible data loss in the one class whose entire job is not losing data.
       *
       * Identity is key + `queuedAt`, not key alone: a capture re-enqueued under the same key during
       * the flush is a *new* entry, and removing it because the old one was sent would lose it too.
       */
      // Under the lock, so an `enqueue` cannot land between this read and the write below — the same
      // interleaving the re-read above was written to survive, one step further in.
      const remaining = await this.serialise(async () => {
        const current = await this.storage.read();
        const keep = current
          .filter((request) => !settled.has(identify(request)))
          .map((request) =>
            retried !== null && identify(request) === identify(retried) ? retried : request,
          );

        if (keep.length === 0) await this.storage.clear();
        else await this.storage.write(keep);
        return keep;
      });

      this.options.onChange?.(remaining.length);
      return { sent, dropped, remaining: remaining.length };
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Run `work` after everything already queued on the lock, whether that succeeded or failed.
   *
   * The chain is advanced with a swallowed rejection so one failed write cannot wedge every later
   * capture behind it — the caller still sees the real error.
   */
  private serialise<R>(work: () => Promise<R>): Promise<R> {
    const run = this.storageLock.then(work, work);
    this.storageLock = run.catch(() => undefined);
    return run;
  }

  private async attempt(request: QueuedRequest): Promise<Disposition> {
    try {
      // Defaulted rather than required: see `QueuedRequest.method`. Every capture that predates
      // progress updates was a POST.
      await this.options.send(request.path, request.body, request.method ?? "POST");
      return "sent";
    } catch (error) {
      if (!isRetryable(error) || request.attempts + 1 >= MAX_ATTEMPTS) {
        this.options.onDropped?.(request, error);
        return "dropped";
      }
      return "retry";
    }
  }
}

/**
 * Flush on reconnect and on load.
 *
 * `online` is the obvious trigger and an unreliable one — it fires when the OS thinks there is a
 * link, which on a train is often before there is a usable one. So the load-time flush matters
 * as much: whatever `online` missed goes out the next time the app opens.
 */
export function startAutoFlush(queue: OfflineQueue): () => void {
  const flush = (): void => {
    void queue.flush();
  };

  // Named, not inline. An anonymous listener cannot be removed, and this disposer is a `useEffect`
  // cleanup — so every remount (React's StrictMode double-invoke in development, or a changed storage
  // prop) left one behind and multiplied the flushes fired on every tab wake.
  const onVisible = (): void => {
    // A tab restored from the background has often been offline in between.
    if (document.visibilityState === "visible") flush();
  };

  window.addEventListener("online", flush);
  document.addEventListener("visibilitychange", onVisible);

  flush();

  return () => {
    window.removeEventListener("online", flush);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/**
 * Identity of a *stored entry*, as opposed to `key`, which identifies the operation.
 *
 * Two entries can share a key across time — `enqueue` replaces in place, so a capture re-recorded
 * while a flush is in flight reuses it — and telling them apart is what lets a flush remove only what
 * it actually settled.
 *
 * The payload is part of the identity, not just the timestamp: `queuedAt` has millisecond precision, so
 * two enqueues in the same millisecond are indistinguishable by it, and dropping the second would be
 * the very loss this guards against. When key, path, body, and method all match it genuinely *is* the
 * same capture, and re-sending one is harmless anyway — every capture endpoint is an idempotent upsert.
 */
function identify(request: QueuedRequest): string {
  return JSON.stringify([
    request.key,
    request.path,
    request.method ?? "POST",
    request.queuedAt,
    request.body,
  ]);
}
