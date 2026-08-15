import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/api/problem.js";
import { meResponse } from "../../../test/fixtures.js";
import { API, problemResponse, server } from "../../../test/msw.js";
import { meKeys, useMe } from "./use-me.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

// Built rather than written out: `/me` returns seven fields and this fixture used
// to carry four, which the client happily cast. See `test/fixtures.ts`.
const ME = meResponse({ locale: "pt-BR", timezone: "America/Sao_Paulo", weekStartsOn: 0 });

describe("useMe", () => {
  it("returns the profile the interface language comes from", async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.json(ME)));

    const { wrapper } = harness();
    const { result } = renderHook(() => useMe(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.locale).toBe("pt-BR");
    expect(result.current.data?.timezone).toBe("America/Sao_Paulo");
    expect(result.current.data?.weekStartsOn).toBe(0);
  });

  it("does not fetch without a session", async () => {
    // Enabled unconditionally, this would 401 on every mount before the sign-in form had
    // even rendered — and MSW is configured to error on an unhandled request, so a
    // regression here fails loudly rather than logging a 401.
    const { wrapper } = harness();
    const { result } = renderHook(() => useMe(false), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it("surfaces a failure rather than falling back to a default profile", async () => {
    // Silently defaulting would render the whole interface in the wrong language while
    // the server kept translating errors in the right one.
    server.use(http.get(`${API}/me`, () => problemResponse(401, "unauthenticated", "Sign in.")));

    const { wrapper } = harness();
    const { result } = renderHook(() => useMe(true), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });

  it("uses one cache key, so the profile is fetched once per session", () => {
    expect(meKeys.me).toEqual(["me"]);
  });
});
