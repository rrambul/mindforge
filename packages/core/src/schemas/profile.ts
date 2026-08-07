import { z } from "zod";
import { SUPPORTED_LOCALES } from "../i18n/locales.js";
import { resolveTimeZone } from "../time/calendar.js";

/**
 * The settings a user can actually change.
 *
 * Until M2 `Profile` was read-only over the API: `MeController` had only a `@Get()`, and the signup
 * trigger inserts nothing but the id. So every real account sat at `timezone: 'UTC'` and
 * `weekStartsOn: 1` with no way out, and "the nightly job runs per user timezone" was a sentence
 * about a column nobody could set. The weekly rhythm is the first milestone where that stops being
 * cosmetic — a plan grid keyed on the wrong week start and a day boundary in the wrong zone are both
 * wrong on the screen, not merely wrong in principle.
 *
 * Every field is optional, and absent means unchanged. There is no PUT: a settings form that sends
 * the whole object silently reverts anything a second tab changed in the meantime.
 */

export const ThemeSchema = z.enum(["light", "dark"]);

export const UpdateProfileSchema = z
  .object({
    /**
     * Validated against `Intl`, not against a hardcoded list. The IANA database gains and loses
     * zones, and a list in this file would be wrong within a year.
     */
    timezone: z
      .string()
      .refine((tz) => resolveTimeZone(tz) === tz, { error: "Unknown IANA timezone" })
      .optional(),
    locale: z.enum(SUPPORTED_LOCALES).optional(),
    contentLanguage: z.enum(SUPPORTED_LOCALES).optional(),
    /**
     * 0 = Sunday. Seeded from locale at signup and owned by the user afterwards (FR-L5) — which is
     * why changing the locale does not change this, and why this is a separate field rather than a
     * derived one.
     */
    weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
    theme: ThemeSchema.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: "Change at least one setting",
  });
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/**
 * Marking the changelog read (§14.1).
 *
 * Separate from the settings patch even though it writes the same row, because it is not a setting:
 * it is a side effect of opening a screen, and folding it into `UpdateProfileSchema` would let a
 * settings form clear the unseen dot as a byproduct of changing the theme.
 */
export const SeenChangelogSchema = z.object({
  /** The newest version the user has now seen. SemVer, matching the root package.json. */
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/u, { error: "Expected a SemVer version" }),
});
export type SeenChangelogInput = z.infer<typeof SeenChangelogSchema>;
