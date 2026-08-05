/**
 * The locale axis.
 *
 * Three settings are kept deliberately separate (TECH-DESIGN.md §5.2): UI
 * locale, timezone, and *content* language — the language the agent writes
 * lessons in. A pt-BR interface with English lessons is a legitimate and likely
 * combination, so collapsing them into one setting would make the product
 * worse. This file owns the first and third; timezone is an IANA string and
 * needs no vocabulary of its own.
 */

export const SUPPORTED_LOCALES = ["en", "pt-BR"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

const BY_LANGUAGE: ReadonlyMap<string, Locale> = new Map(
  // Built from SUPPORTED_LOCALES rather than written out, so adding a locale
  // cannot forget to register its bare language subtag.
  SUPPORTED_LOCALES.map((locale) => [locale.split("-")[0]!.toLowerCase(), locale]),
);

const CANONICAL: ReadonlyMap<string, Locale> = new Map(
  SUPPORTED_LOCALES.map((locale) => [locale.toLowerCase(), locale]),
);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && CANONICAL.get(value.toLowerCase()) === value;
}

/**
 * Coerce a stored or claimed locale to one we actually ship.
 *
 * Falls back rather than throwing, on purpose: a profile row carrying a locale
 * we no longer support must still be able to render an error page. Silently
 * serving English is a far better failure than a 500 on every request.
 *
 * Accepts the shapes that arrive in practice — `pt`, `pt_BR`, `PT-br` — because
 * the value can come from a browser, a JWT, or a hand-edited database row.
 */
export function resolveLocale(candidate: string | null | undefined): Locale {
  if (!candidate) return DEFAULT_LOCALE;

  const normalized = candidate.trim().replace(/_/g, "-").toLowerCase();
  if (normalized === "") return DEFAULT_LOCALE;

  const exact = CANONICAL.get(normalized);
  if (exact) return exact;

  // `pt-PT` resolves to pt-BR: the wrong regional variant of a language we
  // ship is much closer to right than English.
  const language = normalized.split("-")[0]!;
  return BY_LANGUAGE.get(language) ?? DEFAULT_LOCALE;
}

/** 0 = Sunday. Matches `Profile.weekStartsOn`. */
export type WeekStart = 0 | 1;

/**
 * Seeded from locale, then owned by the user (FR-L5).
 *
 * Seeded rather than derived at render time because the weekly plan grid and
 * every "this week" rollup must agree with each other permanently — a user who
 * switches their interface to English should not have last quarter's weeks
 * silently re-bucket underneath them.
 */
export function defaultWeekStartsOn(locale: Locale): WeekStart {
  return locale === "pt-BR" ? 0 : 1;
}
