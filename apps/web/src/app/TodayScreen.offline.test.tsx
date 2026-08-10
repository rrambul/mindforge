import { DEFAULT_LOCALE } from "@mindforge/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { QueuedRequest, QueueStorage } from "../shared/lib/offline-queue.js";
import { OfflineQueueProvider } from "../shared/lib/queue-context.js";
import { API, problemResponse, server } from "../test/msw.js";
import { I18nProvider } from "./providers.js";
import { TodayScreen } from "./TodayScreen.js";

vi.mock("../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

/**
 * Offline behaviour of the capture paths.
 *
 * `offline-queue.test.ts` covers the queue's own ordering and drop rules. What only this level can
 * cover is the branch in each mutation's `onError`: whether a failure is *queued* or *rolled back*.
 * That branch is the difference between "your tap will land" and "your tap is gone", and getting it
 * backwards is silent either way — a rolled-back tap looks like it never happened, and a queued
 * failure that should have been surfaced looks like success.
 */

function memoryStorage(): QueueStorage & { readonly entries: QueuedRequest[] } {
  const state = { entries: [] as QueuedRequest[] };
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

function renderToday(storage: QueueStorage) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        // Mirrors createQueryClient. Without it, userEvent's focus events refetch `running`, the
        // server reports nothing running, and the optimistic timer the queue is honouring is
        // erased — which would make this test fail for a reason the app does not have.
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {/* Real queue, real http client so MSW intercepts the sends — only the storage is swapped. */}
      <OfflineQueueProvider storage={storage}>
        <I18nProvider locale={DEFAULT_LOCALE}>
          <TodayScreen />
        </I18nProvider>
      </OfflineQueueProvider>
    </QueryClientProvider>,
  );
}

/** A request that never reached the server, which is what the http client turns into NetworkError. */
function offline() {
  return HttpResponse.error();
}

describe("the timer offline", () => {
  it("keeps the running timer and queues the start", async () => {
    // A request that never arrived will land later, so removing the timer would be a lie in the
    // other direction — the session is going to exist.
    const storage = memoryStorage();
    server.use(
      http.get(`${API}/focus/sessions/running`, () => HttpResponse.json({ session: null })),
      http.post(`${API}/focus/sessions/start`, () => offline()),
    );

    renderToday(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Start focus" }));

    await waitFor(() => expect(storage.entries).toHaveLength(1));
    expect(storage.entries[0]?.key).toMatch(/^focus:start:[0-9a-f-]{36}$/);
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("rolls the timer back when the server refuses the start", async () => {
    // The opposite branch, and the one that matters more: a timer that appears and then silently is
    // not running is worse than one that never appeared, because you would trust it.
    const storage = memoryStorage();
    server.use(
      http.get(`${API}/focus/sessions/running`, () => HttpResponse.json({ session: null })),
      http.post(`${API}/focus/sessions/start`, () =>
        problemResponse(409, "focus-session-already-running", "Already running."),
      ),
    );

    renderToday(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Start focus" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Already running.");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument(),
    );
    expect(storage.entries).toHaveLength(0);
  });

  it("queues a stop after its start, so the replay cannot invert them", async () => {
    // A stop that reached the server first would 404, and the session would stay open forever.
    const storage = memoryStorage();
    server.use(
      http.get(`${API}/focus/sessions/running`, () => HttpResponse.json({ session: null })),
      http.post(`${API}/focus/sessions/start`, () => offline()),
      http.post(`${API}/focus/sessions/:id/stop`, () => offline()),
    );

    renderToday(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Start focus" }));
    await waitFor(() => expect(storage.entries).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(storage.entries).toHaveLength(2));

    expect(storage.entries.map((entry) => entry.key.split(":").slice(0, 2).join(":"))).toEqual([
      "focus:start",
      "focus:stop",
    ]);
  });

  it("still offers the debrief after a stop that only got queued (FR-F3)", async () => {
    // The debrief was offered on success only, so every session stopped offline lost it — and with no
    // other way back to that session, permanently.
    //
    // The consequence reaches past the missing prompt: a null `hitIntention` makes `producedLearning`
    // false, which classifies every `too_hard` in that block as wasteful friction. The subway sessions
    // the queue exists to protect were the ones skewing the ember/slag split.
    const storage = memoryStorage();
    server.use(
      http.get(`${API}/focus/sessions/running`, () => HttpResponse.json({ session: null })),
      http.post(`${API}/focus/sessions/start`, () => offline()),
      http.post(`${API}/focus/sessions/:id/stop`, () => offline()),
    );

    renderToday(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Start focus" }));
    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));

    expect(await screen.findByText("How did that go?")).toBeVisible();
  });

  it("does not offer the debrief when the server refused the stop", async () => {
    // A 404 means there is no session to debrief, which is a different thing from one that has not
    // arrived yet.
    const storage = memoryStorage();
    server.use(
      http.get(`${API}/focus/sessions/running`, () => HttpResponse.json({ session: null })),
      http.post(`${API}/focus/sessions/start`, () => offline()),
      http.post(`${API}/focus/sessions/:id/stop`, () =>
        problemResponse(404, "focus-session-not-found", "That session no longer exists."),
      ),
    );

    renderToday(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Start focus" }));
    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer exists");
    expect(screen.queryByText("How did that go?")).not.toBeInTheDocument();
  });
});
