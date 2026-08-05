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

      for (; index < queue.length; index += 1) {
        const request = queue[index]!;
        const disposition = await this.attempt(request);

        if (disposition === "sent") {
          sent += 1;
          continue;
        }
        if (disposition === "dropped") {
          dropped += 1;
          continue;
        }

        // Retryable: keep this one and everything behind it, with the attempt counted.
        queue[index] = { ...request, attempts: request.attempts + 1 };
        break;
      }

      const remaining = queue.slice(index);
      if (remaining.length === 0) await this.storage.clear();
      else await this.storage.write(remaining);

      this.options.onChange?.(remaining.length);
      return { sent, dropped, remaining: remaining.length };
    } finally {
      this.flushing = false;
    }
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

  window.addEventListener("online", flush);
  // A tab restored from the background has often been offline in between.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") flush();
  });

  flush();

  return () => {
    window.removeEventListener("online", flush);
  };
}
