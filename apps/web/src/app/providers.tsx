import type { Locale } from "@mindforge/core";
import { QueryClient } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { ApiError } from "../shared/api/problem.js";
import { applyDocumentLocale, createI18n } from "../shared/lib/i18n.js";

/**
 * Query defaults, chosen for what this product actually is.
 *
 * A 4xx is never worth retrying — the token is expired or the body is wrong, and a
 * retry spends time to reach the same answer. A 5xx or a dropped connection is, because
 * on mobile the dropped connection is the common case, not the edge one (§5).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
        // Refetching on window focus would re-run every query each time you come back
        // from the terminal, which for this app is all day.
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      // A failed write is reported, never silently retried into a duplicate. The capture
      // paths become idempotent upserts (§6.1) and can retry safely; nothing else can yet.
      mutations: { retry: false },
    },
  });
}

interface I18nProviderProps {
  readonly locale: Locale;
  readonly children: ReactNode;
}

/**
 * Sits *inside* the QueryClientProvider, on purpose.
 *
 * The interface language comes from the profile, which is server state — so the query
 * that fetches it has to run before this can be built. Nesting the other way would mean
 * rendering the tree in a guessed language and remounting it, which is a visible flash
 * of the wrong language on every cold load.
 *
 * The instance is memoised on `locale`: a change is rare, and when it happens every
 * translated string in the tree does need to re-render.
 */
export function I18nProvider({ locale, children }: I18nProviderProps) {
  const i18n = useMemo(() => {
    applyDocumentLocale(locale);
    return createI18n(locale);
  }, [locale]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
