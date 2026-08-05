import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/api/problem.js";
import { API, problemResponse, server } from "../../../test/msw.js";
import {
  missionKeys,
  useCreateMission,
  useMissions,
  useSetMissionParked,
  type Mission,
} from "./use-missions.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const MISSION: Mission = {
  id: "11111111-1111-4111-8111-111111111111",
  topic: "Rust ownership",
  why: null,
  successLooksLike: null,
  constraints: null,
  currentLevel: null,
  status: "active",
  createdAt: "2026-08-05T12:00:00.000Z",
  updatedAt: "2026-08-05T12:00:00.000Z",
};

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("missionKeys", () => {
  it("distinguishes the unfiltered list from a filtered one", () => {
    // Both live under `missions`, so one invalidation clears both — but they must not
    // share a cache entry, or filtering would show the previous filter's rows.
    expect(missionKeys.list()).toEqual(["missions", "list", "all"]);
    expect(missionKeys.list("parked")).toEqual(["missions", "list", "parked"]);
    expect(missionKeys.list("parked")[0]).toBe(missionKeys.all[0]);
  });
});

describe("useMissions", () => {
  it("requests the unfiltered list when no status is given", async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${API}/missions`, ({ request }) => {
        urls.push(new URL(request.url).search);
        return HttpResponse.json({ missions: [MISSION] });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useMissions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.missions).toHaveLength(1);
    expect(urls).toEqual([""]);
  });

  it("passes the status through as a query parameter", async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${API}/missions`, ({ request }) => {
        urls.push(new URL(request.url).search);
        return HttpResponse.json({ missions: [] });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useMissions("parked"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(urls).toEqual(["?status=parked"]);
  });

  it("surfaces a problem as an ApiError rather than resolving with it", async () => {
    server.use(
      http.get(`${API}/missions`, () => problemResponse(401, "unauthenticated", "Sign in.")),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useMissions(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).problem?.detail).toBe("Sign in.");
  });
});

describe("useCreateMission", () => {
  it("invalidates every mission query on success", async () => {
    // Not a targeted patch: creating consumes a WIP slot, so the list, the count, and
    // whether "new mission" is even available all change together.
    server.use(http.post(`${API}/missions`, () => HttpResponse.json(MISSION, { status: 201 })));

    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateMission(), { wrapper });
    result.current.mutate({
      topic: "Rust ownership",
      why: null,
      successLooksLike: null,
      constraints: null,
      currentLevel: null,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: missionKeys.all });
  });

  it("does not invalidate when the write was refused", async () => {
    // Invalidating on failure would refetch to learn nothing changed, and on a flaky
    // connection that turns one failed write into two requests.
    server.use(
      http.post(`${API}/missions`, () => problemResponse(409, "wip-limit-reached", "At limit.")),
    );

    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateMission(), { wrapper });
    result.current.mutate({
      topic: "One too many",
      why: null,
      successLooksLike: null,
      constraints: null,
      currentLevel: null,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useSetMissionParked", () => {
  it.each([
    [true, "park"],
    [false, "unpark"],
  ])("posts %s to the %s action", async (parked, action) => {
    const paths: string[] = [];
    server.use(
      http.post(`${API}/missions/:id/:action`, ({ params }) => {
        paths.push(String(params["action"]));
        return HttpResponse.json(MISSION, { status: 201 });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useSetMissionParked(), { wrapper });
    result.current.mutate({ id: MISSION.id, parked });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paths).toEqual([action]);
  });
});
