import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../api/problem.js";
import {
  OfflineQueue,
  isRetryable,
  type QueueStorage,
  type QueuedRequest,
} from "./offline-queue.js";

/** In memory, so the tests are about ordering and drop rules rather than about IndexedDB. */
function memoryStorage(initial: QueuedRequest[] = []): QueueStorage & { entries: QueuedRequest[] } {
  const state = { entries: [...initial] };
  return {
    get entries() {
      return state.entries;
    },
    read: () => Promise.resolve([...state.entries]),
    write: (requests) => {
      state.entries = [...requests];
      return Promise.resolve();
    },
    clear: () => {
      state.entries = [];
      return Promise.resolve();
    },
  };
}

function problem(status: number): ApiError {
  return new ApiError(status, null, `status ${status}`);
}

describe("isRetryable", () => {
  it("retries a request that never arrived", () => {
    // The whole reason the queue exists: the subway case.
    expect(isRetryable(new NetworkError(new TypeError("Failed to fetch")))).toBe(true);
  });

  it("retries a 5xx", () => {
    expect(isRetryable(problem(500))).toBe(true);
    expect(isRetryable(problem(503))).toBe(true);
  });

  it("retries a 401, because the SDK will have refreshed the token by the next flush", () => {
    expect(isRetryable(problem(401))).toBe(true);
  });

  it("retries a 429 — that is slow down, not stop", () => {
    expect(isRetryable(problem(429))).toBe(true);
  });

  it("does not retry a 4xx that will fail identically forever", () => {
    // A 422 body does not become valid by waiting, and retrying it would block everything
    // behind it until MAX_ATTEMPTS burned out.
    expect(isRetryable(problem(422))).toBe(false);
    expect(isRetryable(problem(404))).toBe(false);
    expect(isRetryable(problem(409))).toBe(false);
  });

  it("does not retry something that is not an error we recognise", () => {
    expect(isRetryable(new Error("boom"))).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });
});

describe("enqueue", () => {
  it("persists a request", async () => {
    const storage = memoryStorage();
    const queue = new OfflineQueue({ storage, send: () => Promise.resolve() });

    await queue.enqueue("friction:abc", "/friction", { type: "tooling" });

    expect(await queue.pending()).toBe(1);
    expect(storage.entries[0]).toMatchObject({ key: "friction:abc", path: "/friction" });
  });

  it("replaces an entry with the same key rather than appending", async () => {
    // Two taps of Stop on one session are one operation. The server would converge anyway, but
    // sending it twice spends a connection that just proved unreliable.
    const storage = memoryStorage();
    const queue = new OfflineQueue({ storage, send: () => Promise.resolve() });

    await queue.enqueue("focus:stop:1", "/focus/sessions/1/stop", {});
    await queue.enqueue("focus:stop:1", "/focus/sessions/1/stop", {});

    expect(await queue.pending()).toBe(1);
  });

  it("keeps a replaced entry in its original position", async () => {
    // Order is what makes a stop replay after its start. Moving a replaced entry to the back
    // would invert them and the stop would 404.
    const storage = memoryStorage();
    const queue = new OfflineQueue({ storage, send: () => Promise.resolve() });

    await queue.enqueue("focus:start:1", "/focus/sessions/start", { id: "1" });
    await queue.enqueue("focus:stop:1", "/focus/sessions/1/stop", {});
    await queue.enqueue("focus:start:1", "/focus/sessions/start", { id: "1", intention: "later" });

    expect(storage.entries.map((entry) => entry.key)).toEqual(["focus:start:1", "focus:stop:1"]);
  });

  it("reports the pending count as it changes", async () => {
    const onChange = vi.fn();
    const queue = new OfflineQueue({
      storage: memoryStorage(),
      send: () => Promise.resolve(),
      onChange,
    });

    await queue.enqueue("a", "/friction", {});
    await queue.enqueue("b", "/friction", {});

    expect(onChange).toHaveBeenLastCalledWith(2);
  });
});

describe("flush", () => {
  let sent: string[];

  beforeEach(() => {
    sent = [];
  });

  function sender(behaviour: (path: string) => void = () => {}) {
    return (path: string) => {
      behaviour(path);
      sent.push(path);
      return Promise.resolve();
    };
  }

  it("sends everything and empties the queue", async () => {
    const storage = memoryStorage();
    const queue = new OfflineQueue({ storage, send: sender() });

    await queue.enqueue("a", "/friction", { type: "tooling" });
    await queue.enqueue("b", "/friction", { type: "physical" });

    const result = await queue.flush();

    expect(result).toEqual({ sent: 2, dropped: 0, remaining: 0 });
    expect(await queue.pending()).toBe(0);
  });

  it("replays in the order they were queued", async () => {
    // A stop must not reach the server before its start, or the stop 404s and the session stays
    // open forever.
    const storage = memoryStorage();
    const queue = new OfflineQueue({ storage, send: sender() });

    await queue.enqueue("focus:start:1", "/focus/sessions/start", {});
    await queue.enqueue("friction:x", "/friction", {});
    await queue.enqueue("focus:stop:1", "/focus/sessions/1/stop", {});

    await queue.flush();

    expect(sent).toEqual(["/focus/sessions/start", "/friction", "/focus/sessions/1/stop"]);
  });

  it("stops at the first retryable failure instead of skipping ahead", async () => {
    // Skipping would send the stop while the start is still queued. The queue does not know what
    // any request means, so a hard stop is how it preserves the dependency.
    const storage = memoryStorage();
    const queue = new OfflineQueue({
      storage,
      send: sender((path) => {
        if (path.endsWith("/start")) throw new NetworkError(new Error("offline"));
      }),
    });

    await queue.enqueue("focus:start:1", "/focus/sessions/start", {});
    await queue.enqueue("focus:stop:1", "/focus/sessions/1/stop", {});

    const result = await queue.flush();

    expect(sent).toEqual([]);
    expect(result.remaining).toBe(2);
    expect(storage.entries.map((entry) => entry.key)).toEqual(["focus:start:1", "focus:stop:1"]);
  });

  it("counts the attempt on the request that failed", async () => {
    const storage = memoryStorage();
    const queue = new OfflineQueue({
      storage,
      send: () => Promise.reject(new NetworkError(new Error("offline"))),
    });

    await queue.enqueue("a", "/friction", {});
    await queue.flush();
    await queue.flush();

    expect(storage.entries[0]?.attempts).toBe(2);
  });

  it("gives up after enough attempts rather than retrying forever", async () => {
    // An ever-growing queue would spend battery on every reconnect to accomplish nothing, and
    // delay everything behind it.
    const onDropped = vi.fn();
    const storage = memoryStorage();
    const queue = new OfflineQueue({
      storage,
      send: () => Promise.reject(new NetworkError(new Error("offline"))),
      onDropped,
    });

    await queue.enqueue("a", "/friction", {});
    for (let i = 0; i < 10; i += 1) await queue.flush();

    expect(await queue.pending()).toBe(0);
    expect(onDropped).toHaveBeenCalledTimes(1);
  });

  it("drops an unretryable request and keeps going", async () => {
    // A 422 will never succeed. Dropping it lets the rest of the queue through, and reporting it
    // is what stops a dropped capture from being silent data loss.
    const onDropped = vi.fn();
    const storage = memoryStorage();
    const queue = new OfflineQueue({
      storage,
      send: sender((path) => {
        if (path === "/bad") throw new ApiError(422, null, "invalid");
      }),
      onDropped,
    });

    await queue.enqueue("bad", "/bad", {});
    await queue.enqueue("good", "/friction", {});

    const result = await queue.flush();

    expect(result).toEqual({ sent: 1, dropped: 1, remaining: 0 });
    expect(sent).toEqual(["/friction"]);
    expect(onDropped).toHaveBeenCalledTimes(1);
  });

  it("does not run two flushes at once", async () => {
    // Harmless given the upserts, but it doubles the traffic on a connection that just proved
    // itself unreliable.
    const storage = memoryStorage();
    let resolveFirst: (() => void) | undefined;
    const queue = new OfflineQueue({
      storage,
      send: (path) => {
        sent.push(path);
        return new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      },
    });

    await queue.enqueue("a", "/friction", {});

    const first = queue.flush();
    const second = await queue.flush();
    expect(second.sent).toBe(0);

    resolveFirst?.();
    await first;
    expect(sent).toEqual(["/friction"]);
  });

  it("is a no-op on an empty queue", async () => {
    const queue = new OfflineQueue({ storage: memoryStorage(), send: sender() });
    expect(await queue.flush()).toEqual({ sent: 0, dropped: 0, remaining: 0 });
  });

  it("survives a queue restored from a previous session", async () => {
    // The load-time flush is the one that matters most: `online` fires when the OS thinks there
    // is a link, which on a train is often before there is a usable one.
    const storage = memoryStorage([
      {
        key: "friction:a",
        path: "/friction",
        body: {},
        queuedAt: "2026-08-05T12:00:00Z",
        attempts: 3,
      },
    ]);
    const queue = new OfflineQueue({ storage, send: sender() });

    expect(await queue.pending()).toBe(1);
    await queue.flush();
    expect(await queue.pending()).toBe(0);
    expect(sent).toEqual(["/friction"]);
  });
});
