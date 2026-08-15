import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { SpendViewSchema, type SpendView } from "@mindforge/core";

import { api } from "../../../shared/api/http.js";
import type { RequestError } from "../../../shared/api/problem.js";

/**
 * What teaching has cost today (FR-T8).
 *
 * **Every number here was computed on the server**, by the same `budgetStatus`
 * that decides whether the next run is allowed. Nothing in this feature
 * recalculates the fraction or re-derives `exhausted` — a meter that showed room
 * left beside a button that refuses is the exact failure this endpoint exists to
 * prevent (non-negotiable 3).
 */

export const spendKeys = {
  today: ["teach", "spend"] as const,
};

export function useTeachSpend(): UseQueryResult<SpendView, RequestError> {
  return useQuery<SpendView, RequestError>({
    queryKey: spendKeys.today,
    queryFn: ({ signal }) => api.get("/teach/spend", SpendViewSchema, signal),
    // A run costs money and takes minutes, so the figure is stale the moment one
    // finishes. Refetching on focus is enough: nothing here needs to tick.
    staleTime: 30_000,
  });
}

/**
 * Invalidate after anything that could have spent money.
 *
 * Exported rather than called inline so the mutation that starts a run and the
 * meter that displays the result do not each hold their own copy of the key.
 */
export function useInvalidateSpend(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: spendKeys.today });
  };
}
