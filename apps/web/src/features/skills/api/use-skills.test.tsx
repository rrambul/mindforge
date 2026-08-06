import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/api/problem.js";
import { API, problemResponse, server } from "../../../test/msw.js";
import {
  skillKeys,
  useDeleteSkill,
  useEditSkill,
  useRemovePrerequisite,
  useSkills,
} from "./use-skills.js";

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

describe("skillKeys", () => {
  it("distinguishes the unfiltered list from a filtered one", () => {
    // Both live under `skills`, so one invalidation clears both — but they must not collide, or
    // switching the filter would show the previous list's rows.
    expect(skillKeys.list({})).not.toEqual(skillKeys.list({ band: "working" }));
    expect(skillKeys.list({ band: "working" })).not.toEqual(
      skillKeys.list({ overconfidentOnly: true }),
    );
  });
});

describe("useSkills", () => {
  it("puts the filters in the query string", async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${API}/skills`, ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ skills: [] });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useSkills({ band: "fluent", overconfidentOnly: true }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]).toContain("band=fluent");
    expect(seen[0]).toContain("overconfidentOnly=true");
  });

  it("omits the overconfidence filter when it is false", async () => {
    // `overconfidentOnly=false` would be a different cache key for the same request, and the server
    // coerces the string anyway — sending it buys nothing and splits the cache.
    const seen: string[] = [];
    server.use(
      http.get(`${API}/skills`, ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ skills: [] });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useSkills({ overconfidentOnly: false }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]).toBe("");
  });

  it("surfaces a refusal rather than an empty list", async () => {
    // An error rendered as "no skills" would read as a deleted library.
    server.use(http.get(`${API}/skills`, () => problemResponse(500, "internal", "Broke.")));

    const { wrapper } = harness();
    const { result } = renderHook(() => useSkills({}), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});

describe("useEditSkill", () => {
  it("patches only what changed", async () => {
    const sent = vi.fn();
    server.use(
      http.patch(`${API}/skills/:id`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({ id: "s1", name: "Renamed" });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useEditSkill(), { wrapper });
    result.current.mutate({ id: "s1", patch: { name: "Renamed" } });

    await waitFor(() => expect(sent).toHaveBeenCalledWith({ name: "Renamed" }));
  });

  it("reports a refused half-life rather than swallowing it", async () => {
    // Bounded server-side so decay cannot be switched off; the client has to say so.
    server.use(
      http.patch(`${API}/skills/:id`, () =>
        problemResponse(422, "validation-failed", "That half-life is too long."),
      ),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useEditSkill(), { wrapper });
    result.current.mutate({ id: "s1", patch: { halfLifeDays: 100_000 } });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useRemovePrerequisite", () => {
  it("deletes the edge by both ids", async () => {
    // Scoped by skill as well as prerequisite, because the same prerequisite can hang off many skills.
    const seen = vi.fn();
    server.use(
      http.delete(`${API}/skills/:id/prerequisites/:prereqId`, ({ params }) => {
        seen(params["id"], params["prereqId"]);
        return HttpResponse.json({ id: "s1" });
      }),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useRemovePrerequisite(), { wrapper });
    result.current.mutate({ id: "s1", prereqId: "p1" });

    await waitFor(() => expect(seen).toHaveBeenCalledWith("s1", "p1"));
  });
});

describe("useDeleteSkill", () => {
  it("deletes and refreshes the list", async () => {
    const deleted = vi.fn();
    server.use(
      http.get(`${API}/skills`, () => HttpResponse.json({ skills: [] })),
      http.delete(`${API}/skills/:id`, ({ params }) => {
        deleted(params["id"]);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { wrapper, queryClient } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteSkill(), { wrapper });
    result.current.mutate({ id: "s1" });

    await waitFor(() => expect(deleted).toHaveBeenCalledWith("s1"));
    // Refreshed, because a deleted skill must not linger in a list the user is looking at — and its
    // edges are gone too, which changes every other card's picker.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: skillKeys.all }));
  });

  it("surfaces a refusal", async () => {
    server.use(
      http.delete(`${API}/skills/:id`, () =>
        problemResponse(404, "skill-not-found", "That skill no longer exists."),
      ),
    );

    const { wrapper } = harness();
    const { result } = renderHook(() => useDeleteSkill(), { wrapper });
    result.current.mutate({ id: "s1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
