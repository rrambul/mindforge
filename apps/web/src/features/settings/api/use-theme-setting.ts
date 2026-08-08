import { useEffect } from "react";
import { applyTheme, storedTheme } from "../../../shared/lib/theme.js";
import { useProfile, useUpdateProfile, type Theme } from "./use-profile.js";

export interface ThemeSetting {
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
  readonly toggle: () => void;
}

/**
 * One theme, two places it can be changed from — and a rule about which copy wins.
 *
 * There are two stores now. `shared/lib/theme.ts` keeps a localStorage copy, which is what the bar's
 * toggle has always written; M2 added a `profiles.theme` column, which is what this screen writes.
 * A toggle in the bar that disagrees with a select in Settings is worse than either alone, so:
 *
 * **The profile is the setting. localStorage is a cache of it, and only for the first paint.**
 *
 * The direction is decided by what each store can actually do. The first paint happens before any
 * request resolves, and reading the theme from `/me` would mean a light flash on every load of a dark
 * interface — so localStorage has to be read synchronously, and it is. But it is per-device: signing
 * in on a second machine would otherwise silently rewrite an account setting with that machine's
 * default. So when the profile arrives and disagrees, the profile wins and the local copy is
 * overwritten.
 *
 * That only holds if *both* controls write both stores, which is why this hook is exported rather
 * than kept inside the settings screen: it is a drop-in for `useTheme()` in `app/Shell.tsx`, and
 * until the shell adopts it the bar's toggle is a device-local preview that the next profile read
 * reverts. `enabled` is the shell's `signedIn` — signed out there is no profile and no PATCH to make,
 * and the local copy is the whole story.
 */
export function useThemeSetting(enabled = true): ThemeSetting {
  const profile = useProfile(enabled);
  const update = useUpdateProfile();

  // `storedTheme()` is the pre-profile answer, not a fallback for a *failed* read: a profile that
  // 401s or never loads leaves the interface exactly as the last device-local choice left it.
  const theme = profile.data?.theme ?? storedTheme();

  useEffect(() => {
    // Writes the DOM attribute and the localStorage copy together, so the reconciliation above is
    // also what keeps the cache honest for the next first paint.
    applyTheme(theme);
  }, [theme]);

  function setTheme(next: Theme): void {
    // Applied before the request, not after. The mutation patches the cached profile optimistically
    // so the effect above agrees a frame later — this line is what makes the change land on the
    // *tap* rather than on the response.
    applyTheme(next);
    if (profile.data) update.mutate({ theme: next });
  }

  return {
    theme,
    setTheme,
    toggle: () => {
      setTheme(theme === "dark" ? "light" : "dark");
    },
  };
}
