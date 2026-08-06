import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../../../test/msw.js";
import { goalKeys, useEditGoal, useGoals, useReopenGoal } from "./use-goals.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("goalKeys", () => {
  it("distinguishes a mission's goals from the whole list", () => {
    expect(goalKeys.list({})).not.toEqual(goalKeys.list({ missionId: "m1" }));
    expect(goalKeys.list({ status: "met" })).not.toEqual(goalKeys.list({ status: "missed" }));
  });
});

describe("useGoals", () => {
  it("filters on the server", async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${API}/goals`, ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ goals: [] });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useGoals({ status: "active", missionId: "m1" }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]).toContain("status=active");
    expect(seen[0]).toContain("missionId=m1");
  });

  it("sends no query string when nothing is filtered", async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${API}/goals`, ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ goals: [] });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useGoals({}), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]).toBe("");
  });
});

describe("useEditGoal", () => {
  it("patches only what changed", async () => {
    const sent = vi.fn();
    server.use(
      http.patch(`${API}/goals/:id`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({ id: "g1", title: "Revised" });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useEditGoal(), { wrapper });
    result.current.mutate({ id: "g1", patch: { title: "Revised" } });

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ title: "Revised" }));
  });

  it("surfaces a refused edit on a closed goal", async () => {
    // A closed goal is a record of what happened; the server refuses with a 409 and the client has to
    // say why rather than appearing to have saved.
    server.use(
      http.patch(`${API}/goals/:id`, () =>
        problemResponse(409, "goal-already-closed", "That goal is already closed."),
      ),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useEditGoal(), { wrapper });
    result.current.mutate({ id: "g1", patch: { title: "x" } });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useReopenGoal", () => {
  it("posts to the reopen route with an empty body", async () => {
    // Its own endpoint rather than a status patch, so a stray edit cannot resurrect something you
    // decided to stop.
    const sent = vi.fn();
    server.use(
      http.post(`${API}/goals/:id/reopen`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({ id: "g1", status: "active" });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useReopenGoal(), { wrapper });
    result.current.mutate({ id: "g1" });

    await waitFor(() => expect(sent).toHaveBeenCalledWith({}));
  });

  it("surfaces a refusal on a goal that is not closed", async () => {
    server.use(
      http.post(`${API}/goals/:id/reopen`, () =>
        problemResponse(409, "goal-not-closed", "That goal is still active."),
      ),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useReopenGoal(), { wrapper });
    result.current.mutate({ id: "g1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
