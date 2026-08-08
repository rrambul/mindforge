import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { api } from "../../../shared/api/http.js";
import type { RequestError } from "../../../shared/api/problem.js";

/**
 * Teach runs (FR-T3).
 *
 * Not queued offline, and for a stronger reason than the weekly plan's: a teach
 * run costs real money and takes minutes. Replaying one silently on reconnect
 * would bill somebody for a lesson they no longer wanted, and the 409 that
 * follows a duplicate is the *good* outcome rather than the failure mode.
 */

export type AgentRunStatus =
  "queued" | "running" | "succeeded" | "succeeded_with_conflicts" | "failed" | "cancelled";

/** Warnings are stable keys plus ICU args, never prose — the run screen renders in pt-BR too. */
export interface RunWarningView {
  readonly code: string;
  readonly args?: Readonly<Record<string, string | number>>;
}

export interface RunResultView {
  readonly changes?: Readonly<Record<string, readonly string[]>>;
  readonly warnings?: readonly RunWarningView[];
  readonly conflicts?: readonly { readonly path: string; readonly reason: string }[];
  readonly sdkCostUsd?: number;
  readonly turns?: number;
  readonly durationMs?: number;
}

/** Mirrors the API's `AgentRunView`. Note the absent heartbeat — see the controller. */
export interface AgentRunView {
  readonly id: string;
  readonly missionId: string | null;
  readonly kind: string;
  readonly status: AgentRunStatus;
  readonly error: string | null;
  readonly result: RunResultView | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

const TERMINAL: readonly AgentRunStatus[] = [
  "succeeded",
  "succeeded_with_conflicts",
  "failed",
  "cancelled",
];

export function isRunning(status: AgentRunStatus): boolean {
  return !TERMINAL.includes(status);
}

export const teachKeys = {
  runs: (missionId: string) => ["teach", "runs", missionId] as const,
  run: (runId: string) => ["teach", "run", runId] as const,
};

/**
 * A mission's runs, newest first.
 *
 * **Polled while one is active, and only then.** §6 says the SPA should subscribe
 * to `GET /agent-runs/:id/stream` for progress, and it will — but `EventSource`
 * cannot send an `Authorization` header, the guard reads the token from nowhere
 * else, and the SPA sends `credentials: "omit"`, so there is no cookie to ride
 * on. Until that endpoint exists as a `fetch`-parsed stream, a five-second poll
 * is the honest implementation: a run takes minutes, so this is a handful of
 * requests, and it is a compromise on elegance rather than on behaviour.
 */
export function useMissionRuns(missionId: string): UseQueryResult<AgentRunView[], RequestError> {
  return useQuery<AgentRunView[], RequestError>({
    queryKey: teachKeys.runs(missionId),
    queryFn: () => api.get<AgentRunView[]>(`/missions/${missionId}/agent-runs?limit=10`),
    refetchInterval: (query) => {
      const active = query.state.data?.some((run) => isRunning(run.status));
      return active ? 5_000 : false;
    },
  });
}

/**
 * Queue a run.
 *
 * The 409 is not an error to surface as one: one run per mission at a time is a
 * product rule, and the answer to "teach me something" while something is being
 * taught is to show the run in progress. The caller branches on the
 * `run-already-active` slug, and the invalidation below is what makes that
 * possible — a refetch turns the rejection into the run it was rejected for.
 */
export function useStartTeachRun(
  missionId: string,
): UseMutationResult<AgentRunView, RequestError, void> {
  const queryClient = useQueryClient();

  return useMutation<AgentRunView, RequestError, void>({
    mutationFn: () => api.post<AgentRunView>(`/missions/${missionId}/teach`),
    onSettled: () => {
      // On success *and* on failure. A 409 means a run exists that this client
      // does not know about — refetching is what shows it.
      void queryClient.invalidateQueries({ queryKey: teachKeys.runs(missionId) });
    },
  });
}

/** The most recent run, or null. What a mission card shows. */
export function latestRun(runs: readonly AgentRunView[] | undefined): AgentRunView | null {
  return runs?.[0] ?? null;
}
