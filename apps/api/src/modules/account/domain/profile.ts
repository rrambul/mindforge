import { ThemeSchema, type Locale, type WeekStart } from "@mindforge/core";
import type { z } from "zod";

/** Derived from the schema rather than re-declared, so the two cannot drift apart. */
export type Theme = z.infer<typeof ThemeSchema>;

/** Matches the column default. A profile always has a theme; there is no "unset". */
const DEFAULT_THEME: Theme = "light";

/**
 * Coerce the stored `theme`, which is free text with a default and no check constraint.
 *
 * Same reasoning as `resolveLocale`: a value this build no longer ships has to degrade to
 * something renderable rather than take the profile down with it. Every screen in the SPA reads
 * the theme before it paints, so throwing here would lock a user out of their own interface over
 * one bad string.
 */
export function resolveTheme(value: string | null | undefined): Theme {
  const parsed = ThemeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_THEME;
}

/**
 * Who the caller is, and the settings that change what everything else means.
 *
 * A readonly record rather than an entity class, unlike `Resource` or `FrictionEvent`, and the
 * difference is deliberate: those two have rules that a caller could otherwise break — a position
 * past the end of a book, a friction type outside the closed set. A profile has exactly one rule,
 * "absent means unchanged", and that one is expressed by `SettingsPatch` and enforced by an UPDATE
 * that names only the columns present. There is nothing left for a method to guard, and §2.1 says
 * add layers when there is an invariant to protect.
 *
 * `changelogSeenVersion` is null for "never opened", which is not the same as "up to date" (§14.1)
 * — the SPA shows the unseen dot on the first, and nothing on the second.
 */
export interface Profile {
  readonly userId: string;
  readonly locale: Locale;
  /** What the agent writes lessons in. Separate from `locale` on purpose (FR-L3). */
  readonly contentLanguage: Locale;
  /** IANA. Every "day", "week", and nightly job derives from this. */
  readonly timezone: string;
  /** 0 = Sunday. Seeded from locale at signup, user-owned afterwards (FR-L5). */
  readonly weekStartsOn: WeekStart;
  readonly theme: Theme;
  readonly changelogSeenVersion: string | null;
}

/**
 * The settings a request may change, where **absent means unchanged**.
 *
 * Every key is optional and none is nullable: each of these columns is NOT NULL with a default, so
 * "clear this setting" is not a thing a client can mean. `exactOptionalPropertyTypes` is what makes
 * the distinction load-bearing — `{ theme: undefined }` does not satisfy this type, so a patch
 * cannot name a column it has no value for and quietly write it.
 */
export interface SettingsPatch {
  readonly locale?: Locale;
  readonly contentLanguage?: Locale;
  readonly timezone?: string;
  readonly weekStartsOn?: WeekStart;
  readonly theme?: Theme;
}
