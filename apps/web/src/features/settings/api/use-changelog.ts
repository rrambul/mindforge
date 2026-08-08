import { useQuery, type UseQueryResult } from "@tanstack/react-query";

/**
 * One release, as `scripts/build-changelog.mjs` writes it.
 *
 * `body` is the Markdown from `CHANGELOG.md` verbatim — the file stays the source (§14.1), and the
 * screen parses it rather than keeping a second copy of the prose that would drift the first time
 * somebody edited the one they had open. `date` is null for a release written by hand before
 * release-please put a date on the heading.
 */
export interface Release {
  readonly version: string;
  readonly date: string | null;
  readonly body: string;
}

export const changelogKeys = {
  all: ["changelog"] as const,
};

/**
 * The changelog, from the SPA's own origin rather than from the API.
 *
 * It is the same for every user and changes only when a release ships, so an endpoint would be a
 * database read of a constant — and served as a static asset the screen renders with no round trip
 * and keeps working offline like the rest of the shell. Which is also why this is the one hook in the
 * app that calls `fetch` directly: `shared/api/http.ts` prefixes `/v1` and attaches a bearer token,
 * and this request wants neither.
 *
 * Newest first, as written. A malformed artifact degrades to an empty history rather than throwing
 * through the screen — a broken build step should not take Settings down with it.
 */
export function useChangelog(): UseQueryResult<readonly Release[]> {
  return useQuery({
    queryKey: changelogKeys.all,
    queryFn: async ({ signal }): Promise<readonly Release[]> => {
      const response = await fetch("/changelog.json", { signal });
      if (!response.ok) throw new Error(`changelog.json responded ${response.status}`);
      const payload: unknown = await response.json();
      return Array.isArray(payload) ? (payload as readonly Release[]) : [];
    },
    // A build artifact. It cannot change while the tab is open.
    staleTime: Infinity,
  });
}
