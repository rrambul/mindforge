import type {
  AddPrerequisiteInput,
  Band,
  CalibrationVerdict,
  CreateSkillInput,
  Feather,
  ListSkillsQuery,
  RateSkillInput,
  UpdateSkillInput,
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

/** Mirrors the API's SkillView. */
export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  /** The self-rating. Null means you have not said. */
  readonly perceivedLevel: number | null;
  /** The **decayed** score. Null means unproven — never 0. */
  readonly score: number | null;
  readonly scoreStdDev: number | null;
  readonly band: Band | null;
  /** The band the self-rating falls in — derived server-side, never recomputed here. */
  readonly perceivedBand: Band | null;
  readonly feather: Feather;
  readonly halfLifeDays: number;
  readonly lastEvidenceAt: string | null;
  readonly calibrationGap: number | null;
  readonly calibrationVerdict: CalibrationVerdict | null;
  readonly calibrationMissing: "score" | "self_rating" | "both" | null;
  readonly bandGap: number | null;
  readonly prerequisiteIds: readonly string[];
  readonly createdAt: string;
}

export const skillKeys = {
  all: ["skills"] as const,
  list: (query: ListSkillsQuery) =>
    ["skills", "list", query.band ?? "", query.overconfidentOnly ?? false] as const,
};

function toSearch(query: ListSkillsQuery): string {
  const params = new URLSearchParams();
  if (query.band) params.set("band", query.band);
  if (query.overconfidentOnly) params.set("overconfidentOnly", "true");
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

export function useSkills(query: ListSkillsQuery): UseQueryResult<{ skills: Skill[] }> {
  return useQuery({
    queryKey: skillKeys.list(query),
    queryFn: ({ signal }) => api.get<{ skills: Skill[] }>(`/skills${toSearch(query)}`, signal),
    // Every score is computed fresh from decay on the server (FR-S4), so a cached one is a figure that
    // was true when it was fetched. Cheap to refetch, and actively misleading to keep.
    staleTime: 0,
  });
}

/**
 * Nothing here is a capture path, so nothing is queued offline.
 *
 * Adding a skill, rating yourself, declaring a prerequisite — all considered acts, and a failure has to
 * be visible. A silently replayed prerequisite could also land after the graph changed underneath it,
 * which is precisely when the cycle check needs to run against what is actually stored.
 */
export function useCreateSkill(): UseMutationResult<Skill, RequestError, CreateSkillInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body) => api.post<Skill>("/skills", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

export function useEditSkill(): UseMutationResult<
  Skill,
  RequestError,
  { id: string; patch: UpdateSkillInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }) => api.patch<Skill>(`/skills/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

/**
 * The self-rating (FR-S5) — its own endpoint, writing one column.
 *
 * Separate from `useEditSkill` for the same reason the server keeps it separate: the rule that a rating
 * is not evidence is easier to hold when the only thing this request can carry is the rating.
 */
export function useRateSkill(): UseMutationResult<
  Skill,
  RequestError,
  { id: string; body: RateSkillInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }) => api.patch<Skill>(`/skills/${id}/rating`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

export function useAddPrerequisite(): UseMutationResult<
  Skill,
  RequestError,
  { id: string; body: AddPrerequisiteInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }) => api.post<Skill>(`/skills/${id}/prerequisites`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

export function useRemovePrerequisite(): UseMutationResult<
  Skill,
  RequestError,
  { id: string; prereqId: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, prereqId }) => api.delete<Skill>(`/skills/${id}/prerequisites/${prereqId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

export function useDeleteSkill(): UseMutationResult<void, RequestError, { id: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }) => api.delete<void>(`/skills/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: skillKeys.all }),
  });
}
