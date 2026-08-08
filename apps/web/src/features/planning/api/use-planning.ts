import type {
  CompleteWeeklyReviewInput,
  IsoDate,
  PlanRow,
  PlanVsActual,
  PutWeeklyPlanInput,
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

/**
 * The weekly rhythm's data layer (FR-F5, FR-F6).
 *
 * Nothing here is a capture path, so nothing is queued offline — `PutWeeklyPlanSchema` in
 * `packages/core` says why in as many words: a plan that replayed silently on reconnect could
 * overwrite one you made in the meantime, and losing a decision is worse than seeing a request fail.
 */

/** Mirrors the API's `AllocationView`. Two nullable ids, so a GET body is a legal PUT body. */
export interface AllocationView {
  readonly missionId: string | null;
  readonly skillId: string | null;
  readonly plannedMinutes: number;
}

/** Mirrors the API's `WeeklyPlanView`. */
export interface WeeklyPlanView {
  /** The **normalised** week, which may not be the date that was asked for. */
  readonly weekStart: IsoDate;
  /** Empty for a week nobody planned. Empty is a set; it is neither an absence nor a 404. */
  readonly allocations: readonly AllocationView[];
  readonly plannedTotal: number;
}

/**
 * A plan-vs-actual row, extending core's rather than restating it.
 *
 * `PlanRow` is where `plannedMinutes: null` and `attainment: null` are *defined* to mean "unplanned
 * work", and a hand-copied interface is a claim about the server rather than a check on one — the
 * mistake `SummaryResponse` in `features/friction` already had to be rescued from.
 */
export interface LabelledPlanRow extends PlanRow {
  /** Null when the subject has no readable name. Never "Unknown" — the SPA decides how to say so. */
  readonly label: string | null;
}

export interface WeeklyPlanVsActualView extends Omit<PlanVsActual, "rows"> {
  readonly weekStart: IsoDate;
  readonly rows: readonly LabelledPlanRow[];
}

/** Mirrors the API's `WeeklyReviewView`. */
export interface WeeklyReviewView {
  readonly id: string;
  readonly weekStart: IsoDate;
  /** When the ritual happened — not when it was last edited. */
  readonly completedAt: string;
  readonly changedOneThing: string | null;
  readonly note: string | null;
}

/**
 * Keys as a factory. An invalidation that misspells a key invalidates nothing, and the symptom is a
 * screen that shows last week's numbers some of the time.
 */
export const planningKeys = {
  all: ["planning"] as const,
  plan: (weekStart: IsoDate) => ["planning", "plan", weekStart] as const,
  actual: (weekStart: IsoDate) => ["planning", "actual", weekStart] as const,
  reviews: ["planning", "reviews"] as const,
};

/**
 * The week is never optional here.
 *
 * It is derived from the profile's `weekStartsOn`, which loads asynchronously — but the screens in
 * `app/` already hold their whole render behind that, because a heading, a nav bar and a grid built
 * on a guessed week would all be wrong together. An `enabled` guard here would be a second, weaker
 * copy of that gate, and its "not yet" branch is one no caller can reach.
 */
export function useWeeklyPlan(weekStart: IsoDate): UseQueryResult<WeeklyPlanView> {
  return useQuery({
    queryKey: planningKeys.plan(weekStart),
    queryFn: ({ signal }) => api.get<WeeklyPlanView>(`/plans/${weekStart}`, signal),
  });
}

export function usePlanVsActual(weekStart: IsoDate): UseQueryResult<WeeklyPlanVsActualView> {
  return useQuery({
    queryKey: planningKeys.actual(weekStart),
    queryFn: ({ signal }) => api.get<WeeklyPlanVsActualView>(`/plans/${weekStart}/actual`, signal),
    // Actuals move every time a session is logged, and the review screen is the one place a stale
    // figure would be acted on.
    staleTime: 0,
  });
}

/**
 * Replaces a whole week (FR-F5).
 *
 * A PUT, because the grid is edited as a grid: shifting an hour from one mission to another is one
 * decision, and two independent requests can land in either order and leave the week over-allocated
 * in between.
 */
export function useSaveWeeklyPlan(): UseMutationResult<
  WeeklyPlanView,
  RequestError,
  { weekStart: IsoDate; body: PutWeeklyPlanInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ weekStart, body }) => api.put<WeeklyPlanView>(`/plans/${weekStart}`, body),
    // Both halves of the screen move: the plan changed, and so did every attainment computed against
    // it. Invalidating the whole namespace rather than the two keys keeps a third reader — the
    // Today block — from showing a total the grid above it disagrees with.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: planningKeys.all }),
  });
}

export function useWeeklyReviews(): UseQueryResult<{ reviews: WeeklyReviewView[] }> {
  return useQuery({
    queryKey: planningKeys.reviews,
    queryFn: ({ signal }) => api.get<{ reviews: WeeklyReviewView[] }>("/reviews/weekly", signal),
  });
}

/**
 * The ritual (FR-F6). Idempotent upsert: a second submission revises what you decided without moving
 * when you decided it.
 */
export function useCompleteWeeklyReview(): UseMutationResult<
  WeeklyReviewView,
  RequestError,
  { weekStart: IsoDate; body: CompleteWeeklyReviewInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ weekStart, body }) =>
      api.post<WeeklyReviewView>(`/reviews/weekly/${weekStart}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: planningKeys.reviews }),
  });
}
