import type { UpdateProfileInput } from "@mindforge/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { API, problemResponse, server } from "../../../test/msw.js";
import { profileKeys, useProfile, useUpdateProfile, type Profile } from "./use-profile.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const STORED: Profile = {
  userId: "11111111-1111-4111-8111-111111111111",
  locale: "en",
  contentLanguage: "en",
  timezone: "UTC",
  weekStartsOn: 1,
  theme: "light",
  changelogSeenVersion: null,
};

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // `gcTime: Infinity`, unlike the other suites: several of these assert on what
      // `setQueryData` left in the cache, and an entry with no observer is collected the instant it
      // is written when gcTime is 0 — so the optimistic patch would read back as undefined and the
      // test would be asserting the collector rather than the mutation. A fresh client per test is
      // what keeps them independent.
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Answers the PATCH with the stored row plus the patch, the way the API does. */
function acceptsPatch(seen: UpdateProfileInput[] = []) {
  server.use(
    http.patch(`${API}/me`, async ({ request }) => {
      const patch = (await request.json()) as UpdateProfileInput;
      seen.push(patch);
      return HttpResponse.json({ ...STORED, ...patch });
    }),
  );
  server.use(http.get(`${API}/me`, () => HttpResponse.json(STORED)));
  return seen;
}

describe("useProfile", () => {
  it("reads the same cache entry the shell already holds", async () => {
    // The key is deliberately `["me"]` — the array `features/auth` uses — so the interface changes
    // language the moment this screen changes the locale. Asserted from the app layer too, where
    // importing both constants is legal; here it is the literal shape that matters.
    expect(profileKeys.me).toEqual(["me"]);

    server.use(http.get(`${API}/me`, () => HttpResponse.json(STORED)));
    const { wrapper } = harness();
    const { result } = renderHook(() => useProfile(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.contentLanguage).toBe("en");
  });

  it("asks for nothing while there is no session", () => {
    // The shell renders signed out, where /me is a 401 — and MSW would fail the test on a request
    // no handler covers, which is exactly the point.
    const { wrapper } = harness();
    const { result } = renderHook(() => useProfile(false), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useUpdateProfile", () => {
  it("sends only what the caller changed", async () => {
    const seen = acceptsPatch();
    const { wrapper } = harness();
    const { result } = renderHook(() => useUpdateProfile(), { wrapper });

    result.current.mutate({ theme: "dark" });

    await waitFor(() => expect(seen).toHaveLength(1));
    // Absent means unchanged. A form that posted the whole object would revert whatever a second tab
    // changed while it was open.
    expect(seen[0]).toEqual({ theme: "dark" });
  });

  it("patches the cached profile before the response lands", async () => {
    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(profileKeys.me, STORED);
    acceptsPatch();

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ theme: "dark" });

    // The theme has to land on the tap: the bar toggle and the settings select run through this
    // mutation, and a round trip between the two would bounce the palette back.
    await waitFor(() =>
      expect(queryClient.getQueryData<Profile>(profileKeys.me)?.theme).toBe("dark"),
    );
  });

  it("puts the old value back when the server refuses", async () => {
    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(profileKeys.me, STORED);
    server.use(
      http.patch(`${API}/me`, () => problemResponse(422, "validation-failed", "Unknown timezone.")),
    );
    server.use(http.get(`${API}/me`, () => HttpResponse.json(STORED)));

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ theme: "dark" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData<Profile>(profileKeys.me)?.theme).toBe("light");
  });

  it("invalidates every cached query when the timezone changes", async () => {
    // The whole cache, not a list of keys. Every "today" and "this week" on screen was bucketed by
    // the server from the old zone, and the queries holding them live in features this one may not
    // import (§2.2 rule 6) — an enumeration would be correct until somebody renamed one.
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    acceptsPatch();

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ timezone: "America/Sao_Paulo" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith();
  });

  it("invalidates everything when the week start changes", async () => {
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    acceptsPatch();

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ weekStartsOn: 0 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith();
  });

  it("does not refetch the world for a theme change", async () => {
    // Nothing else on screen is derived from it, and paying for a full refetch on a palette switch
    // would make the cheapest setting the most expensive one.
    const { queryClient, wrapper } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    acceptsPatch();

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ theme: "dark" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).not.toHaveBeenCalledWith();
  });

  it("leaves the interface language to the shared cache entry rather than a second copy", async () => {
    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(profileKeys.me, STORED);
    acceptsPatch();

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ locale: "pt-BR" });

    await waitFor(() =>
      expect(queryClient.getQueryData<Profile>(profileKeys.me)?.locale).toBe("pt-BR"),
    );
  });
});
