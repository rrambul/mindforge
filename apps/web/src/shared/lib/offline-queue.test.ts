import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../api/problem.js";
import {
  OfflineQueue,
  idbStorageFor,
  isRetryable,
  startAutoFlush,
  type QueueStorage,
  type QueuedRequest,
} from "./offline-queue.js";

/**
 * IndexedDB, as a Map.
 *
 * jsdom has no IndexedDB and adding a polyfill would test `fake-indexeddb`'s fidelity rather than
 * the thing that can be wrong here, which is *which key* each user reads and writes.
 */
const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }));

vi.mock("idb-keyval", () => ({
  get: (key: string) => Promise.resolve(store.get(key)),
  set: (key: string, value: unknown) => {
    store.set(key, value);
    return Promise.resolve();
  },
  del: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
}));

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

describe("two captures at once", () => {
  /**
   * A storage whose `read` genuinely yields before resolving.
   *
   * `memoryStorage` resolves on an already-settled promise, so two `enqueue` calls interleave only at
   * a microtask boundary and happen to survive. Real IndexedDB does not: `read` is a request whose
   * callback lands a full tick later, which is exactly the window the lock exists to close. A test
   * against the friendlier double would have passed with or without the fix.
   */
  function slowStorage(): QueueStorage & { entries: QueuedRequest[] } {
    const state = { entries: [] as QueuedRequest[] };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    return {
      get entries() {
        return state.entries;
      },
      read: async () => {
        await tick();
        return [...state.entries];
      },
      write: async (requests) => {
        await tick();
        state.entries = [...requests];
      },
      clear: async () => {
        await tick();
        state.entries = [];
      },
    };
  }

  it("keeps both, rather than the second erasing the first", async () => {
    // Two friction chips tapped in the same second offline. Every call site is
    // `void queue.enqueue(…)`, so nothing awaits the previous one — and before the lock both reads
    // returned `[]` and the second write dropped the first capture with no `onDropped`, because it
    // never became a request the server could refuse.
    const storage = slowStorage();
    const queue = new OfflineQueue({ send: () => Promise.reject(new Error("offline")), storage });

    await Promise.all([
      queue.enqueue("friction:1", "/friction", { type: "tooling" }),
      queue.enqueue("friction:2", "/friction", { type: "interruption" }),
    ]);

    expect(storage.entries.map((entry) => entry.key)).toEqual(["friction:1", "friction:2"]);
  });

  it("still collapses a replay of the same key", async () => {
    // The lock must not turn idempotent replay into duplication: one key is still one entry.
    const storage = slowStorage();
    const queue = new OfflineQueue({ send: () => Promise.reject(new Error("offline")), storage });

    await Promise.all([
      queue.enqueue("focus:start:a", "/focus/sessions/start", { intention: "first" }),
      queue.enqueue("focus:start:a", "/focus/sessions/start", { intention: "second" }),
    ]);

    expect(storage.entries).toHaveLength(1);
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

describe("idbStorageFor", () => {
  const ALICE = "11111111-1111-4111-8111-111111111111";
  const BOB = "22222222-2222-4222-8222-222222222222";

  function entry(key: string): QueuedRequest {
    return { key, path: "/friction", body: {}, queuedAt: "2026-08-05T12:00:00Z", attempts: 0 };
  }

  beforeEach(() => {
    store.clear();
  });

  /**
   * The one this exists for.
   *
   * IndexedDB is per-origin, not per-account, and the key used to be a constant. So signing out with
   * unsent captures and signing in as somebody else replayed them with the *new* user's token — and
   * because every capture endpoint is an idempotent upsert on a client-minted UUID, they landed
   * cleanly in the wrong account and looked exactly like real rows.
   */
  it("keeps one user's captures out of another's queue", async () => {
    const alice = idbStorageFor(ALICE);
    const bob = idbStorageFor(BOB);

    await alice.write([entry("friction:a")]);

    expect(await bob.read()).toEqual([]);
    expect(await alice.read()).toHaveLength(1);
  });

  it("does not empty one user's queue when another's is cleared", async () => {
    const alice = idbStorageFor(ALICE);
    const bob = idbStorageFor(BOB);
    await alice.write([entry("friction:a")]);
    await bob.write([entry("friction:b")]);

    await bob.clear();

    expect(await alice.read()).toHaveLength(1);
    expect(await bob.read()).toEqual([]);
  });

  describe("the queue left behind by the unscoped version", () => {
    // Created per test rather than annotated on a shared `let`: `MockInstance`'s signature moves
    // between vitest majors, and inference does not.
    const silenceWarnings = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /**
     * Dropped rather than adopted, and this test is the decision rather than a description of it.
     *
     * Adopting reads as the kinder option and is the same bug once more: an unscoped queue records
     * no owner, so giving it to whoever signs in first is exactly the misattributed write the
     * scoping exists to stop — silently, because an upsert makes it indistinguishable from real data.
     */
    it("is discarded rather than replayed into whichever account signs in first", async () => {
      silenceWarnings();
      store.set("mindforge.offline-queue", [entry("friction:orphan")]);

      expect(await idbStorageFor(ALICE).read()).toEqual([]);
      expect(store.has("mindforge.offline-queue")).toBe(false);
    });

    it("says so out loud, because an abandoned capture is real data loss", async () => {
      const warn = silenceWarnings();
      store.set("mindforge.offline-queue", [entry("friction:orphan")]);

      await idbStorageFor(ALICE).read();

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain("1 capture");
    });

    it("stays quiet when there was nothing in it", async () => {
      const warn = silenceWarnings();
      store.set("mindforge.offline-queue", []);

      await idbStorageFor(ALICE).read();

      expect(warn).not.toHaveBeenCalled();
      expect(store.has("mindforge.offline-queue")).toBe(false);
    });

    // Every path through the queue reads first, so a check on each read would run on every flush
    // and every tap, for a key that is gone after the first one.
    it("is looked for once per storage, not on every read", async () => {
      silenceWarnings();
      const alice = idbStorageFor(ALICE);
      await alice.read();

      store.set("mindforge.offline-queue", [entry("friction:later")]);
      await alice.read();

      expect(store.has("mindforge.offline-queue")).toBe(true);
    });
  });
});
