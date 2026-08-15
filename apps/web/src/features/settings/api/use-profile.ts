import {
  MeViewSchema,
  type MeView,
  type SeenChangelogInput,
  type ThemeSchema,
  type UpdateProfileInput,
} from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { z } from "zod";
import { api } from "../../../shared/api/http.js";
import type { RequestError } from "../../../shared/api/problem.js";

/** Derived from the schema the API validates with, so the two cannot drift. */
export type Theme = z.infer<typeof ThemeSchema>;

/**
 * The API's own shape, from `packages/core` — the same type `features/auth` reads.
 *
 * The two used to be separate declarations of one row, this one fuller than that
 * one. They share a cache key, so they must also share a schema: parsing strips
 * unknown keys, and a narrow schema filling the entry first would silently delete
 * the three fields only this screen uses.
 */
export type Profile = MeView;

/**
 * **The same key array as `features/auth`'s `meKeys.me`, deliberately.**
 *
 * Query keys are structural, so both hooks observe one cache entry and one in-flight request — which
 * is the point: the shell reads the locale from that entry to decide what language the app is in, and
 * a settings screen writing to a *second* key would leave the interface in the old language until a
 * reload. §2.2 rule 6 forbids importing the constant from another feature, so the equality is
 * asserted from the app layer instead, where importing both is legal — see `app/SettingsScreen.test.tsx`.
 */
export const profileKeys = {
  me: ["me"] as const,
};

/**
 * The profile, read from the same cache entry the shell already holds.
 *
 * `enabled` exists for the one caller that runs outside a session: `useThemeSetting` is meant to be
 * the shell's theme control, and the shell renders while signed out, where `/me` is a 401.
 */
export function useProfile(enabled = true): UseQueryResult<Profile> {
  return useQuery({
    queryKey: profileKeys.me,
    queryFn: ({ signal }) => api.get("/me", MeViewSchema, signal),
    enabled,
    // These change only when this screen changes them, and the mutation below invalidates.
    staleTime: Infinity,
  });
}

/**
 * Timezone and week start are the two settings that re-bucket everything already on screen.
 *
 * Every "today", "this week", and day column in the app is derived from them by the *server*, from
 * data the client is holding — so nothing on screen re-derives itself when they change. The plan
 * grid stays on last week, yesterday's sessions stay on yesterday.
 */
function changesTheCalendar(patch: UpdateProfileInput): boolean {
  return patch.timezone !== undefined || patch.weekStartsOn !== undefined;
}

/**
 * The patch applied to a cached profile, field by field.
 *
 * Not `{ ...previous, ...patch }`: every key on the patch is optional, and a spread of an optional
 * property widens the result to `Locale | undefined` — so the shorthand does not type-check against
 * a `Profile` whose fields are all required. Which is `exactOptionalPropertyTypes` doing its job:
 * "absent" and "present but undefined" are different things, and only the first means unchanged.
 */
function withPatch(previous: Profile, patch: UpdateProfileInput): Profile {
  return {
    ...previous,
    ...(patch.locale === undefined ? {} : { locale: patch.locale }),
    ...(patch.contentLanguage === undefined ? {} : { contentLanguage: patch.contentLanguage }),
    ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
    ...(patch.weekStartsOn === undefined ? {} : { weekStartsOn: patch.weekStartsOn }),
    ...(patch.theme === undefined ? {} : { theme: patch.theme }),
  };
}

/**
 * The settings write (FR-L3, FR-L5). Absent means unchanged, so callers send only what moved.
 *
 * **Optimistic, because one of these fields is the theme.** The bar's toggle and this screen's select
 * are the same mechanism (`useThemeSetting`), and a theme that waited for a round trip would visibly
 * bounce back to the old palette between the tap and the response.
 *
 * **A calendar change invalidates the whole cache, not a list of keys.** The queries that would go
 * stale live in `features/planning` and `features/insights`, which this feature may not import (§2.2
 * rule 6) — and an enumeration of another feature's keys is a list that is correct until someone
 * renames one, at which point the screen quietly shows yesterday's day boundaries. A locale or theme
 * change takes the narrow path, so the expensive answer is only paid for by the two settings that
 * need it.
 */
export function useUpdateProfile(): UseMutationResult<
  Profile,
  RequestError,
  UpdateProfileInput,
  { previous: Profile | undefined }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch) => api.patch("/me", MeViewSchema, patch),
    onMutate: async (patch) => {
      // Or an in-flight GET could land after the patch and overwrite it with the old row.
      await queryClient.cancelQueries({ queryKey: profileKeys.me });
      const previous = queryClient.getQueryData<Profile>(profileKeys.me);
      if (previous) queryClient.setQueryData<Profile>(profileKeys.me, withPatch(previous, patch));
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(profileKeys.me, context.previous);
    },
    onSuccess: (updated, patch) => {
      // The response is the row, so there is nothing to refetch on the narrow path.
      queryClient.setQueryData(profileKeys.me, updated);
      if (changesTheCalendar(patch)) void queryClient.invalidateQueries();
    },
  });
}

/**
 * §14.1 — you opened Settings, so you have seen the changelog.
 *
 * Its own endpoint rather than a field on the patch above, and its own hook here for the same
 * reason: folding it in would let changing the theme clear the unseen dot.
 */
export function useMarkChangelogSeen(): UseMutationResult<
  Profile,
  RequestError,
  SeenChangelogInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body) => api.post("/me/changelog-seen", MeViewSchema, body),
    onSuccess: (updated) => queryClient.setQueryData(profileKeys.me, updated),
  });
}
