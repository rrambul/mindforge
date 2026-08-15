import {
  MissionListSchema,
  MissionViewSchema,
  type CreateMissionInput,
  type MissionList,
  type MissionStatus,
  type MissionView,
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
 * The API's own shape, from `packages/core` — not a copy of it.
 *
 * This was a hand-written mirror with a one-line comment pointing at the server's
 * declaration, and nothing checked the two still matched. `Mission` stays as an
 * alias because the whole feature reads better for it.
 */
export type Mission = MissionView;
type MissionsResponse = MissionList;

/**
 * Keys as a factory, not string literals at the call site. An invalidation that
 * misspells a key silently invalidates nothing, and the symptom is a screen that
 * shows stale data some of the time.
 */
export const missionKeys = {
  all: ["missions"] as const,
  list: (status?: MissionStatus) => ["missions", "list", status ?? "all"] as const,
};

export function useMissions(status?: MissionStatus): UseQueryResult<MissionsResponse> {
  return useQuery({
    queryKey: missionKeys.list(status),
    queryFn: ({ signal }) =>
      api.get(status ? `/missions?status=${status}` : "/missions", MissionListSchema, signal),
  });
}

/**
 * Not optimistic, deliberately.
 *
 * §5 mandates optimistic writes for the *capture* paths — start timer, log friction,
 * mark progress — because those are on the ≤5s budget. Creating a mission is neither:
 * it is a considered, desktop-first action, and it is the one write the server can
 * refuse on a rule the client cannot fully evaluate (the WIP limit is a count the
 * client only has a cached view of). Showing the mission and then removing it would
 * be worse than waiting.
 */
export function useCreateMission(): UseMutationResult<Mission, RequestError, CreateMissionInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => api.post("/missions", MissionViewSchema, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: missionKeys.all }),
  });
}

/**
 * Park and unpark share a mutation because they share every failure mode: both can
 * 404, and both can 409 on a status the client thought it knew. `action` is the only
 * difference, so two hooks would be two copies of the same error handling.
 */
export function useSetMissionParked(): UseMutationResult<
  Mission,
  RequestError,
  { id: string; parked: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parked }) =>
      api.post(`/missions/${id}/${parked ? "park" : "unpark"}`, MissionViewSchema),
    // Invalidated rather than patched into the cache: parking frees a WIP slot, so the
    // list, the count, and whether "new mission" is available all change together.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: missionKeys.all }),
  });
}
