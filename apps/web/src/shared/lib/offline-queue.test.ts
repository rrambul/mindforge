import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../api/problem.js";
import {
  OfflineQueue,
  isRetryable,
  startAutoFlush,
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

describe("a capture queued while a flush is in flight", () => {
  it("is not discarded when the flush finishes", async () => {
    // The normal case on a bad connection, not an exotic race: a flush starts, you tap a friction chip
    // two seconds later, the flush completes. Writing back its own stale snapshot silently dropped the
    // new event — and `clear()` on a fully-drained snapshot wiped it outright, with `onDropped` never
    // firing. Invisible data loss in the one class whose job is not losing data.
    const storage = memoryStorage();
    const queue = new OfflineQueue({
      storage,
      send: async (path) => {
        // Enqueued mid-flight, exactly as a chip tap would.
        if (path === "/friction") {
          await queue.enqueue("focus:stop:s1", "/focus/sessions/s1/stop", {});
        }
        return Promise.resolve();
      },
    });

    await queue.enqueue("friction:a", "/friction", { type: "tooling" });
    const result = await queue.flush();

    expect(result.sent).toBe(1);
    // The stop survived, and is still there to be sent by the next flush.
    expect(storage.entries.map((entry) => entry.key)).toEqual(["focus:stop:s1"]);
    expect(await queue.pending()).toBe(1);
  });

  it("sends it on the next flush", async () => {
    const sent: string[] = [];
    const storage = memoryStorage();
    const queue = new OfflineQueue({
      storage,
      send: async (path) => {
        sent.push(path);
        if (path === "/friction" && sent.length === 1) {
          await queue.enqueue("friction:b", "/friction", { type: "too_hard" });
        }
        return Promise.resolve();
      },
    });

    await queue.enqueue("friction:a", "/friction", { type: "tooling" });
    await queue.flush();
    await queue.flush();

    expect(sent).toHaveLength(2);
    expect(await queue.pending()).toBe(0);
  });

  it("keeps a re-enqueued entry under a key the flush had already sent", async () => {
    // Identity is key + queuedAt, not key alone. A stop re-recorded during the flush is a new entry,
    // and removing it because the old one succeeded would lose it.
    const storage = memoryStorage();
    const queue = new OfflineQueue({
      storage,
      send: async (path) => {
        if (path === "/focus/sessions/s1/stop" && storage.entries.length === 1) {
          await queue.enqueue("focus:stop:s1", "/focus/sessions/s1/stop", { again: true });
        }
        return Promise.resolve();
      },
    });

    await queue.enqueue("focus:stop:s1", "/focus/sessions/s1/stop", {});
    await queue.flush();

    expect(storage.entries).toHaveLength(1);
    expect(storage.entries[0]?.body).toEqual({ again: true });
  });
});

describe("startAutoFlush", () => {
  it("removes every listener it added", () => {
    // The disposer is a `useEffect` cleanup, so a listener left behind multiplies the flushes fired on
    // every tab wake — once per remount, forever.
    const flushes: number[] = [];
    const queue = new OfflineQueue({
      storage: memoryStorage(),
      send: () => Promise.resolve(),
    });
    const spy = vi.spyOn(queue, "flush").mockImplementation(() => {
      flushes.push(1);
      return Promise.resolve({ sent: 0, dropped: 0, remaining: 0 });
    });

    const stop = startAutoFlush(queue);
    // One from the load-time flush.
    expect(flushes).toHaveLength(1);

    stop();
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(flushes).toHaveLength(1);
    spy.mockRestore();
  });

  it("flushes when the tab becomes visible again", () => {
    // The behaviour the listener exists for, asserted so removing it in the disposer cannot be
    // mistaken for never adding it.
    const queue = new OfflineQueue({
      storage: memoryStorage(),
      send: () => Promise.resolve(),
    });
    const spy = vi.spyOn(queue, "flush").mockResolvedValue({ sent: 0, dropped: 0, remaining: 0 });

    const stop = startAutoFlush(queue);
    spy.mockClear();

    document.dispatchEvent(new Event("visibilitychange"));
    expect(spy).toHaveBeenCalledTimes(1);

    stop();
    spy.mockRestore();
  });
});

describe("the method", () => {
  it("defaults to POST, which every capture but progress uses", async () => {
    const storage = memoryStorage();
    const queue = new OfflineQueue({ storage, send: () => Promise.resolve() });

    await queue.enqueue("friction:abc", "/friction", { type: "tooling" });
    expect(storage.entries[0]?.method).toBe("POST");
  });

  it("replays a progress update as the PATCH it was", async () => {
    // A progress update sent as a POST would hit the collection route and mint a second resource.
    const calls: { path: string; method: string }[] = [];
    const queue = new OfflineQueue({
      storage: memoryStorage(),
      send: (path, _body, method) => {
        calls.push({ path, method });
        return Promise.resolve();
      },
    });

    await queue.enqueue("progress:r1", "/resources/r1/progress", { current: 137 }, "PATCH");
    await queue.flush();

    expect(calls).toEqual([{ path: "/resources/r1/progress", method: "PATCH" }]);
  });

  it("replays an entry stored before methods existed", async () => {
    // A queue survives a deploy. Treating a missing method as unreplayable would drop exactly the
    // captures this class exists to keep.
    const storage = memoryStorage();
    await storage.write([
      {
        key: "friction:legacy",
        path: "/friction",
        body: { type: "tooling" },
        queuedAt: "2026-08-05T12:00:00.000Z",
        attempts: 0,
      },
    ]);

    const methods: string[] = [];
    const queue = new OfflineQueue({
      storage,
      send: (_path, _body, method) => {
        methods.push(method);
        return Promise.resolve();
      },
    });

    await expect(queue.flush()).resolves.toMatchObject({ sent: 1, remaining: 0 });
    expect(methods).toEqual(["POST"]);
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
