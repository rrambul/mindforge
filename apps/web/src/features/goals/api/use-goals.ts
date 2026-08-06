import type {
  CloseGoalInput,
  CreateGoalInput,
  CreateGoalTargetInput,
  GoalStatus,
  ListGoalsQuery,
  TargetKind,
  UpdateGoalInput,
} from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";
import type { RequestError } from "../../../shared/api/problem.js";

/** Mirrors the API's TargetView. */
export interface GoalTarget {
  readonly id: string;
  readonly kind: TargetKind;
  readonly weight: number;
  /** 0..1, or null when it cannot be measured — never 0 standing in for absent data. */
  readonly fraction: number | null;
  readonly met: boolean;
  readonly unmeasurable: "no_data" | "not_yet_implemented" | null;
  readonly metAt: string | null;
  readonly resourceId: string | null;
  readonly skillId: string | null;
  readonly missionId: string | null;
  readonly target: Record<string, number | string>;
}

/** Mirrors the API's GoalView. */
export interface Goal {
  readonly id: string;
  readonly missionId: string | null;
  readonly title: string;
  readonly definitionOfDone: string | null;
  /** `YYYY-MM-DD` — a calendar day, never parsed into a Date for display. */
  readonly targetDate: string | null;
  readonly status: GoalStatus;
  readonly outcomeNote: string | null;
  readonly fraction: number | null;
  readonly targetCount: number;
  readonly measuredWeight: number;
  readonly totalWeight: number;
  readonly allTargetsMet: boolean;
  readonly targets: readonly GoalTarget[];
  readonly createdAt: string;
}

export const goalKeys = {
  all: ["goals"] as const,
  list: (query: ListGoalsQuery) =>
    ["goals", "list", query.status ?? "", query.missionId ?? ""] as const,
};

function toSearch(query: ListGoalsQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.missionId) params.set("missionId", query.missionId);
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

export function useGoals(query: ListGoalsQuery): UseQueryResult<{ goals: Goal[] }> {
  return useQuery({
    queryKey: goalKeys.list(query),
    queryFn: ({ signal }) => api.get<{ goals: Goal[] }>(`/goals${toSearch(query)}`, signal),
    // Progress is derived server-side from evidence that other screens change — finishing a book or
    // logging a session moves it. So a cached figure here is one of the few that can be wrong without
    // anything on this screen having happened.
    staleTime: 0,
  });
}

/**
 * Nothing here is a capture path.
 *
 * Every goal write is a considered act — writing one down, closing one, ticking a manual target — so
 * none of them is queued offline and every failure is shown. The contrast with resources is
 * deliberate: a capture that vanishes is lost data, while a goal edit that silently replays later
 * could reopen something you decided to stop.
 */
export function useCreateGoal(): UseMutationResult<Goal, RequestError, CreateGoalInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body) => api.post<Goal>("/goals", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: goalKeys.all }),
  });
}

export function useEditGoal(): UseMutationResult<
  Goal,
  RequestError,
  { id: string; patch: UpdateGoalInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }) => api.patch<Goal>(`/goals/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: goalKeys.all }),
  });
}

export function useCloseGoal(): UseMutationResult<
  Goal,
  RequestError,
  { id: string; body: CloseGoalInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }) => api.post<Goal>(`/goals/${id}/close`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: goalKeys.all }),
  });
}

export function useReopenGoal(): UseMutationResult<Goal, RequestError, { id: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }) => api.post<Goal>(`/goals/${id}/reopen`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: goalKeys.all }),
  });
}

export function useAddTarget(): UseMutationResult<
  Goal,
  RequestError,
  { goalId: string; target: CreateGoalTargetInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ goalId, target }) => api.post<Goal>(`/goals/${goalId}/targets`, target),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: goalKeys.all }),
  });
}

export function useRemoveTarget(): UseMutationResult<
  Goal,
  RequestError,
  { goalId: string; targetId: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ goalId, targetId }) => api.delete<Goal>(`/goals/${goalId}/targets/${targetId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: goalKeys.all }),
  });
}

/**
 * The escape hatch (§3.8) — the only write in the whole feature that sets a target's state.
 *
 * A boolean, never a number. The server refuses it for every other kind, so this cannot become a way
 * to hand-enter a computed figure.
 */
export function useSetManualTarget(): UseMutationResult<
  Goal,
  RequestError,
  { goalId: string; targetId: string; satisfied: boolean }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ goalId, targetId, satisfied }) =>
      api.patch<Goal>(`/goals/${goalId}/targets/${targetId}/manual`, { satisfied }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: goalKeys.all }),
  });
}
