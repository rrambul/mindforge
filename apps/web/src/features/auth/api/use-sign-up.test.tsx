import type { UpdateProfileInput } from "@mindforge/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meResponse } from "../../../test/fixtures.js";
import { API, problemResponse, server } from "../../../test/msw.js";
import { useSignUp } from "./use-sign-up.js";

/** Typed rather than bare, so the mock's return is not an `any` flowing into the module under test. */
interface Credentials {
  email: string;
  password: string;
}
const signUp = vi.fn<(credentials: Credentials) => Promise<{ error: unknown }>>();

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: { signUp: (credentials: Credentials) => signUp(credentials) } },
}));

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Records what the seed actually sent, which is the whole assertion. */
function acceptsPatch(seen: UpdateProfileInput[]) {
  server.use(
    http.patch(`${API}/me`, async ({ request }) => {
      seen.push((await request.json()) as UpdateProfileInput);
      // The endpoint answers with the profile it just wrote, and the hook parses
      // it — an empty object here passed only while the response was cast.
      return HttpResponse.json(meResponse());
    }),
  );
}

afterEach(() => {
  signUp.mockReset();
});

describe("useSignUp", () => {
  /**
   * The one this exists for (FR-L5).
   *
   * `defaultWeekStartsOn` lived in `packages/core` with tests and no callers, because the only thing
   * that creates a profile is a trigger on `auth.users` and a trigger cannot see a browser. So a
   * pt-BR account opened its weekly plan grid on Monday while its calendar starts Sunday.
   */
  it("seeds a pt-BR account's week to Sunday", async () => {
    signUp.mockResolvedValue({ error: null });
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-BR"]);
    const seen: UpdateProfileInput[] = [];
    acceptsPatch(seen);

    const { wrapper } = harness();
    const { result } = renderHook(() => useSignUp(), { wrapper });
    await result.current("someone@example.test", "pw");

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ locale: "pt-BR", weekStartsOn: 0 });
  });

  it("seeds an English account's week to Monday", async () => {
    signUp.mockResolvedValue({ error: null });
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
    const seen: UpdateProfileInput[] = [];
    acceptsPatch(seen);

    const { wrapper } = harness();
    const { result } = renderHook(() => useSignUp(), { wrapper });
    await result.current("someone@example.test", "pw");

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ locale: "en", weekStartsOn: 1 });
  });

  /** FR-L3: separately overridable afterwards, but it starts as the interface language. */
  it("starts the content language on the interface language rather than English", async () => {
    signUp.mockResolvedValue({ error: null });
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-BR"]);
    const seen: UpdateProfileInput[] = [];
    acceptsPatch(seen);

    const { wrapper } = harness();
    const { result } = renderHook(() => useSignUp(), { wrapper });
    await result.current("someone@example.test", "pw");

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.contentLanguage).toBe("pt-BR");
  });

  /**
   * §5.2 — every "day", "week", nightly job and activity square derives from this, so a new account
   * left on UTC has all of them bucketed by a calendar nobody chose.
   */
  it("seeds the timezone the browser is actually in", async () => {
    signUp.mockResolvedValue({ error: null });
    const seen: UpdateProfileInput[] = [];
    acceptsPatch(seen);

    const { wrapper } = harness();
    const { result } = renderHook(() => useSignUp(), { wrapper });
    await result.current("someone@example.test", "pw");

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("does not seed anything when the account was not created", async () => {
    signUp.mockResolvedValue({ error: new Error("already registered") });
    const seen: UpdateProfileInput[] = [];
    acceptsPatch(seen);

    const { wrapper } = harness();
    const { result } = renderHook(() => useSignUp(), { wrapper });
    const { error } = await result.current("someone@example.test", "pw");

    expect(error).toBeInstanceOf(Error);
    expect(seen).toEqual([]);
  });

  /**
   * Reported to the caller as a success, because it is one.
   *
   * The account exists by this point, so failing the form would be a lie and the retry it invites
   * answers "already registered". Every seeded field is reachable from Settings.
   */
  it("still reports a successful sign-up when the seed fails", async () => {
    signUp.mockResolvedValue({ error: null });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    server.use(http.patch(`${API}/me`, () => problemResponse(500, "internal", "Something broke")));

    const { wrapper } = harness();
    const { result } = renderHook(() => useSignUp(), { wrapper });

    expect(await result.current("someone@example.test", "pw")).toEqual({ error: null });
    // Not silent, though: a profile quietly on the wrong calendar looks like broken arithmetic
    // rather than broken setup.
    expect(error).toHaveBeenCalledOnce();
  });

  /**
   * `onAuthStateChange` fires inside `signUp`, so `useMe` has already gone out for a profile this
   * request then changed — and `["me"]` has `staleTime: Infinity`, so the losing order sticks for the
   * whole session: the first screen after signup renders on UTC and Monday and never corrects itself.
   */
  it("drops what was cached before the seed landed", async () => {
    signUp.mockResolvedValue({ error: null });
    acceptsPatch([]);

    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(["me"], { timezone: "UTC", weekStartsOn: 1 });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSignUp(), { wrapper });
    await result.current("someone@example.test", "pw");

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });
});
