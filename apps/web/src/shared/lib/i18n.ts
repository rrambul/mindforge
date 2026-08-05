import { DEFAULT_LOCALE, SUPPORTED_LOCALES, resolveLocale, type Locale } from "@mindforge/core";
import i18next, { type i18n as I18n } from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";

import enAuth from "../../locales/en/auth.json";
import enCommon from "../../locales/en/common.json";
import enFocus from "../../locales/en/focus.json";
import enFriction from "../../locales/en/friction.json";
import enGlossary from "../../locales/en/glossary.json";
import enMissions from "../../locales/en/missions.json";
import ptAuth from "../../locales/pt-BR/auth.json";
import ptCommon from "../../locales/pt-BR/common.json";
import ptFocus from "../../locales/pt-BR/focus.json";
import ptFriction from "../../locales/pt-BR/friction.json";
import ptGlossary from "../../locales/pt-BR/glossary.json";
import ptMissions from "../../locales/pt-BR/missions.json";

/**
 * react-i18next with ICU MessageFormat, the same syntax the server-side bundle uses
 * (TECH-DESIGN.md §5.2). One message dialect across both halves means a string can
 * move between them without being rewritten.
 *
 * Bundles are imported rather than lazily fetched. §5.2 calls for lazy-loading per
 * route, and that is right at scale — but there are four namespaces and two locales
 * here, and a translation arriving a frame after the component that needs it is a
 * flash of untranslated content on the first screen. Revisit when the bundle is big
 * enough to measure.
 */
export const NAMESPACES = ["common", "glossary", "auth", "missions", "focus", "friction"] as const;

const resources = {
  en: {
    common: enCommon,
    glossary: enGlossary,
    auth: enAuth,
    missions: enMissions,
    focus: enFocus,
    friction: enFriction,
  },
  "pt-BR": {
    common: ptCommon,
    glossary: ptGlossary,
    auth: ptAuth,
    missions: ptMissions,
    focus: ptFocus,
    friction: ptFriction,
  },
} as const satisfies Record<Locale, Record<(typeof NAMESPACES)[number], unknown>>;

export function createI18n(locale: Locale): I18n {
  const instance = i18next.createInstance();

  void instance
    .use(ICU)
    .use(initReactI18next)
    .init({
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      ns: [...NAMESPACES],
      defaultNS: "common",
      resources,
      interpolation: {
        // ICU does the formatting; react handles escaping. i18next's own escaping
        // would double-encode an apostrophe in "You're at the limit".
        escapeValue: false,
      },
      // A missing key is a build failure (FR-L7, scripts/check-i18n-keys.mjs), so
      // there is no reason to also render one silently in development.
      returnEmptyString: false,
    });

  return instance;
}

/**
 * The best guess before the profile is known.
 *
 * Used only for the sign-in screen and for errors raised before authentication — once
 * there is a session, the profile's stored locale wins, because that is what the API
 * translates its `detail` strings with.
 */
export function guessLocaleFromBrowser(): Locale {
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const resolved = resolveLocale(candidate);
    // resolveLocale falls back rather than failing, so an unsupported tag returns the
    // default; only treat it as a match when it genuinely is one.
    if (resolved !== DEFAULT_LOCALE || candidate.toLowerCase().startsWith("en")) return resolved;
  }
  return DEFAULT_LOCALE;
}

/** `lang` and `dir` on <html>, per §5.2. Both locales are LTR; dir is set anyway. */
export function applyDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = "ltr";
}
