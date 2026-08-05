import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { QueuedRequest, QueueStorage } from "../../../shared/lib/offline-queue.js";
import { OfflineQueueProvider } from "../../../shared/lib/queue-context.js";
import { API, problemResponse, server } from "../../../test/msw.js";
import {
  captureBody,
  resourceKeys,
  useAbandonResource,
  useCaptureResource,
  useFinishResource,
  useMarkProgress,
  useResources,
} from "./use-resources.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

/** In-memory, so a test can read what was queued instead of inferring it from behaviour. */
function memoryStorage(): QueueStorage & { entries: QueuedRequest[] } {
  const state = { entries: [] as QueuedRequest[] };
  return {
    entries: state.entries,
    read: () => Promise.resolve([...state.entries]),
    write: (requests) => {
      state.entries.length = 0;
      state.entries.push(...requests);
      return Promise.resolve();
    },
    clear: () => {
      state.entries.length = 0;
      return Promise.resolve();
    },
  };
}

/**
 * Storage is always injected, even where a test does not read it: the provider's default is
 * IndexedDB, which jsdom does not have, and the resulting rejection is unhandled noise rather than a
 * failure — so it would sit in the output misleading whoever reads it next.
 */
function harness(storage: QueueStorage = memoryStorage()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <OfflineQueueProvider storage={storage}>{children}</OfflineQueueProvider>
    </QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Fails the request the way a dropped connection does, rather than with a status. */
function unreachable(path: string) {
  server.use(http.post(`${API}${path}`, () => HttpResponse.error()));
}

describe("resourceKeys", () => {
  it("distinguishes an unfiltered list from a filtered one", () => {
    // Both live under `resources`, so one invalidation clears both — but they must not collide, or
    // switching the filter would show the previous list's rows.
    expect(resourceKeys.list({})).not.toEqual(resourceKeys.list({ status: "inbox" }));
    expect(resourceKeys.list({ status: "inbox" })).not.toEqual(resourceKeys.list({ type: "book" }));
  });
});

describe("captureBody", () => {
  it("mints an id, which is what makes a replay idempotent", () => {
    expect(captureBody({ url: "https://example.test/a" }).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("carries a mission when the capture came from one", () => {
    const missionId = "11111111-1111-4111-8111-111111111111";
    expect(captureBody({ url: "https://example.test/a", missionId }).missionId).toBe(missionId);
  });

  it("omits the mission entirely rather than sending null", () => {
    // The schema is exactOptional: a present-but-null field is a different thing from an absent one.
    expect("missionId" in captureBody({ url: "https://example.test/a" })).toBe(false);
  });
});

describe("useResources", () => {
  it("puts the filter in the query string, not in the client", async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${API}/resources`, ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ resources: [] });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useResources({ status: "inbox", type: "book" }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]).toContain("status=inbox");
    expect(seen[0]).toContain("type=book");
  });

  it("sends no query string when nothing is filtered", async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${API}/resources`, ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ resources: [] });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useResources({}), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]).toBe("");
  });
});

describe("the offline queue", () => {
  it("queues a capture the server never received (FR-R2)", async () => {
    // The realistic case §5 names: you paste a link on the subway. Losing it would be the worst
    // outcome on the most-used path, and the URL is the only thing worth keeping.
    const storage = memoryStorage();
    unreachable("/resources/capture");

    const { wrapper } = harness(storage);
    const { result } = renderHook(() => useCaptureResource(), { wrapper });

    const body = captureBody({ url: "https://example.test/a" });
    result.current.mutate(body);

    await waitFor(() => expect(storage.entries).toHaveLength(1));
    expect(storage.entries[0]).toMatchObject({
      key: `resource:${body.id}`,
      path: "/resources/capture",
      method: "POST",
    });
    // The queued body is the one that failed, id included — re-deriving it would mint a new id and
    // turn a replay into a duplicate.
    expect(storage.entries[0]?.body).toEqual(body);
  });

  it("queues a progress update as a PATCH", async () => {
    // Sent as a POST it would hit the collection route and mint a second resource.
    const storage = memoryStorage();
    server.use(http.patch(`${API}/resources/:id/progress`, () => HttpResponse.error()));

    const { wrapper } = harness(storage);
    const { result } = renderHook(() => useMarkProgress(), { wrapper });

    result.current.mutate({ id: "r1", patch: { current: 137, total: 590 } });

    await waitFor(() => expect(storage.entries).toHaveLength(1));
    expect(storage.entries[0]).toMatchObject({
      key: "progress:r1",
      path: "/resources/r1/progress",
      method: "PATCH",
    });
  });

  it("does not queue a capture the server refused", async () => {
    // A 422 body does not become valid by waiting, and retrying it forever would delay the captures
    // behind it while accomplishing nothing.
    const storage = memoryStorage();
    server.use(
      http.post(`${API}/resources/capture`, () =>
        problemResponse(422, "validation-failed", "That is not a URL."),
      ),
    );

    const { wrapper } = harness(storage);
    const { result } = renderHook(() => useCaptureResource(), { wrapper });
    result.current.mutate(captureBody({ url: "nonsense" }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(storage.entries).toHaveLength(0);
  });

  it("does not queue a finish or an abandon", async () => {
    // Not captures: they are considered decisions about something already saved, so a failure has to
    // be visible rather than replayed silently later against a resource you may have changed since.
    const storage = memoryStorage();
    unreachable("/resources/r1/finish");
    unreachable("/resources/r1/abandon");

    const { wrapper } = harness(storage);
    const finish = renderHook(() => useFinishResource(), { wrapper });
    finish.result.current.mutate({ id: "r1" });
    await waitFor(() => expect(finish.result.current.isError).toBe(true));

    const abandon = renderHook(() => useAbandonResource(), { wrapper });
    abandon.result.current.mutate({ id: "r1" });
    await waitFor(() => expect(abandon.result.current.isError).toBe(true));

    expect(storage.entries).toHaveLength(0);
  });
});

describe("useAbandonResource", () => {
  it("sends an empty body when there is no reason (FR-R5)", async () => {
    const sent = vi.fn();
    server.use(
      http.post(`${API}/resources/:id/abandon`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({});
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useAbandonResource(), { wrapper });
    result.current.mutate({ id: "r1" });

    await waitFor(() => expect(sent).toHaveBeenCalledWith({}));
  });

  it("sends the reason when there is one, because it is prime friction data", async () => {
    const sent = vi.fn();
    server.use(
      http.post(`${API}/resources/:id/abandon`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({});
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useAbandonResource(), { wrapper });
    result.current.mutate({ id: "r1", reason: "too shallow" });

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ reason: "too shallow" }));
  });
});
