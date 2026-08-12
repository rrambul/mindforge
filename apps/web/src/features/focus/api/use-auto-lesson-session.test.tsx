import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { API, server } from "../../../test/msw.js";
import { AUTO_MAX_MINUTES, SETTLE_MS, useAutoLessonSession } from "./use-auto-lesson-session.js";
import type { FocusSession } from "./use-focus.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const LESSON = "33333333-3333-4333-8333-333333333333";

/**
 * Time is frozen and the ages below are measured from it.
 *
 * The suite bans a bare `new Date()` for the reason this file would otherwise prove: a
 * test about "older than 45 minutes" that reads the wall clock is one whose fixtures
 * drift as it runs, and whose failure would arrive as a flake rather than as an answer.
 * `shared/lib/clock` is the single seam the browser reads it through, so faking it here
 * fakes it for the hook as well.
 */
const NOW = new Date("2026-08-11T18:00:00.000Z");

vi.mock("../../../shared/lib/clock.js", () => ({
  now: () => NOW,
  nowIso: () => NOW.toISOString(),
}));

/** An ISO instant `minutes` before the frozen clock. */
function agedMinutes(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

function session(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    intention: null,
    startedAt: agedMinutes(0),
    endedAt: null,
    plannedMinutes: null,
    minutes: null,
    isRunning: true,
    entryMode: "timer",
    hitIntention: null,
    focusQuality: null,
    energy: null,
    note: null,
    missionId: null,
    lessonId: null,
    ...overrides,
  };
}

/** `{session}` from the running endpoint, plus recorders for the two writes. */
function stack(running: FocusSession | null) {
  const started: Record<string, unknown>[] = [];
  const stopped: string[] = [];

  server.use(
    http.get(`${API}/focus/sessions/running`, () => HttpResponse.json({ session: running })),
    http.post(`${API}/focus/sessions/start`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      started.push(body);
      return HttpResponse.json(session({ id: String(body.id), entryMode: "auto" }));
    }),
    http.post(`${API}/focus/sessions/:id/stop`, ({ params }) => {
      stopped.push(String(params.id));
      return HttpResponse.json(session({ endedAt: agedMinutes(0), isRunning: false }));
    }),
  );

  return { started, stopped };
}

describe("useAutoLessonSession", () => {
  it("starts an auto session for the lesson when nothing else is running", async () => {
    // The whole point: reading a lesson is activity, and it lands on the grid without
    // anyone pressing start.
    const { started } = stack(null);
    const { wrapper } = harness();

    renderHook(() => useAutoLessonSession(LESSON, true), { wrapper });

    await waitFor(() => expect(started).toHaveLength(1), { timeout: SETTLE_MS + 3_000 });
    expect(started[0]).toMatchObject({ lessonId: LESSON, entryMode: "auto" });
  });

  it("records it as auto rather than timer", async () => {
    // `entryMode` is what keeps "the reader was open" and "I declared I was focusing"
    // two populations. Recorded as `timer` there would be no way back — FR-F2's rule
    // about backfilled data, one step further out.
    const { started } = stack(null);
    const { wrapper } = harness();

    renderHook(() => useAutoLessonSession(LESSON, true), { wrapper });

    await waitFor(() => expect(started).toHaveLength(1), { timeout: SETTLE_MS + 3_000 });
    expect(started[0]).not.toMatchObject({ entryMode: "timer" });
  });

  it("does not start one while a deliberate timer is running", async () => {
    // Two concurrent sessions have no meaning, and the API refuses the second. Starting
    // anyway would spend a 409 on every lesson opened during a block you started.
    const { started } = stack(session({ entryMode: "timer" }));
    const { wrapper } = harness();

    renderHook(() => useAutoLessonSession(LESSON, true), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 300));
    expect(started).toHaveLength(0);
  });

  it("does nothing at all when disabled", async () => {
    // `LessonRoute` mounts this only for a lesson with a file behind it; the flag is the
    // second guard, so a planned lesson never records minutes against a file that is not
    // there.
    const { started } = stack(null);
    const { wrapper } = harness();

    renderHook(() => useAutoLessonSession(LESSON, false), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 300));
    expect(started).toHaveLength(0);
  });

  it("stops the session it started when the reader goes away", async () => {
    // Leaving the page ends the measurement. Without this the session stays open, and an
    // open session is worth zero minutes to the rollup — the read would vanish entirely.
    const { started, stopped } = stack(null);
    const { wrapper } = harness();

    const view = renderHook(() => useAutoLessonSession(LESSON, true), { wrapper });
    await waitFor(() => expect(started).toHaveLength(1), { timeout: SETTLE_MS + 3_000 });

    view.unmount();

    await waitFor(() => expect(stopped).toEqual([started[0]!.id]));
  });

  it("reaps an auto session a closed tab left running past the cap", async () => {
    // `pagehide` cannot be relied on to finish a POST, so the way back in is where this
    // gets cleaned up. Otherwise the next start is a 409 forever.
    const abandoned = session({
      id: "55555555-5555-4555-8555-555555555555",
      entryMode: "auto",
      startedAt: agedMinutes(AUTO_MAX_MINUTES + 5),
    });
    const { stopped } = stack(abandoned);
    const { wrapper } = harness();

    renderHook(() => useAutoLessonSession(LESSON, true), { wrapper });

    await waitFor(() => expect(stopped).toContain(abandoned.id));
  });

  it("leaves a recent auto session alone", async () => {
    // Only *past the cap* is abandoned. A session started a minute ago on another tab is
    // a session that is still being read.
    const recent = session({ entryMode: "auto", startedAt: agedMinutes(1) });
    const { stopped } = stack(recent);
    const { wrapper } = harness();

    renderHook(() => useAutoLessonSession(LESSON, true), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 300));
    expect(stopped).toHaveLength(0);
  });

  it("never reaps a deliberate timer, however old", async () => {
    // A block you started and left running is yours. The cost of it is a 409 on the next
    // start, and that is a decision for you to make rather than one to be cleaned up.
    const old = session({
      entryMode: "timer",
      startedAt: agedMinutes(6 * 60),
    });
    const { stopped } = stack(old);
    const { wrapper } = harness();

    renderHook(() => useAutoLessonSession(LESSON, true), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 300));
    expect(stopped).toHaveLength(0);
  });
});

describe("useAutoLessonSession, leaving before the start has landed", () => {
  /** Like `stack`, but the start hangs until the returned `land` is called. */
  function slowStack() {
    const started: string[] = [];
    const stopped: string[] = [];
    let land: (() => void) | null = null;
    const arrived = new Promise<void>((resolve) => {
      land = resolve;
    });

    server.use(
      http.get(`${API}/focus/sessions/running`, () => HttpResponse.json({ session: null })),
      http.post(`${API}/focus/sessions/start`, async ({ request }) => {
        const body = (await request.json()) as { id: string };
        started.push(body.id);
        await arrived;
        return HttpResponse.json(session({ id: body.id, entryMode: "auto" }));
      }),
      http.post(`${API}/focus/sessions/:id/stop`, ({ params }) => {
        stopped.push(String(params.id));
        return HttpResponse.json(session({ endedAt: agedMinutes(0), isRunning: false }));
      }),
    );

    return { started, stopped, land: () => land?.() };
  }

  it("waits for the start before stopping, instead of 404ing and stranding it", async () => {
    // Open a lesson, decide it is the wrong one, go straight back. The stop used to be
    // sent while the start was still in flight: a 404 on a session that then existed and
    // ran forever, so every later start answered 409. The API logged both during E2E.
    const { started, stopped, land } = slowStack();
    const { wrapper } = harness();

    const view = renderHook(() => useAutoLessonSession(LESSON, true), { wrapper });
    await waitFor(() => expect(started).toHaveLength(1), { timeout: SETTLE_MS + 3_000 });

    view.unmount();
    expect(stopped).toHaveLength(0);

    land();

    await waitFor(() => expect(stopped).toEqual([started[0]]));
  });
});

describe("useAutoLessonSession, when the start is refused", () => {
  it("does not then stop a session that was never created", async () => {
    // A 409 for a block started on another device between the running read and this
    // write. Stopping the id we minted would 404 against a session that never existed.
    const stopped: string[] = [];

    server.use(
      http.get(`${API}/focus/sessions/running`, () => HttpResponse.json({ session: null })),
      http.post(`${API}/focus/sessions/start`, () =>
        HttpResponse.json({ detail: "already running" }, { status: 409 }),
      ),
      http.post(`${API}/focus/sessions/:id/stop`, ({ params }) => {
        stopped.push(String(params.id));
        return HttpResponse.json(session({ isRunning: false }));
      }),
    );

    const { wrapper } = harness();
    const view = renderHook(() => useAutoLessonSession(LESSON, true), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 300));
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 300));

    expect(stopped).toHaveLength(0);
  });
});

describe("useAutoLessonSession, opening and leaving straight away", () => {
  it("records nothing at all", async () => {
    // Opening a lesson and going back is not a read. Starting on the mount recorded it
    // as one — a row of a few hundred milliseconds, worth zero minutes, cluttering the
    // history — and in development it doubled every genuine open, because React mounts,
    // unmounts and remounts each effect.
    const { started, stopped } = stack(null);
    const { wrapper } = harness();

    const view = renderHook(() => useAutoLessonSession(LESSON, true), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS / 4));
    view.unmount();

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 300));
    expect(started).toHaveLength(0);
    expect(stopped).toHaveLength(0);
  });
});
