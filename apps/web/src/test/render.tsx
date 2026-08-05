import { DEFAULT_LOCALE, type Locale } from "@mindforge/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider } from "../app/providers.js";

/**
 * Renders a route with the providers it actually runs under, and real translations.
 *
 * Not a mocked `t` returning keys: the bundles are the contract this app renders, and a
 * test asserting on `missions.wip.full` would pass while the user saw a raw key. It also
 * means a test can be written in pt-BR to check ICU plurals in the language whose rules
 * differ from English's.
 */
export function renderWithProviders(
  ui: ReactNode,
  options: { locale?: Locale } = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: {
      // No retries and no caching between tests: a retry turns an asserted failure into
      // a timeout, and a shared cache makes tests order-dependent.
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale={options.locale ?? DEFAULT_LOCALE}>{ui}</I18nProvider>
    </QueryClientProvider>,
  );

  return { ...result, queryClient };
}
