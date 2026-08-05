import type {
  CaptureResourceInput,
  CreateResourceInput,
  ListResourcesQuery,
  ResourceProgress,
  ResourceStatus,
  ResourceType,
  UpdateProgressInput,
  UpdateResourceInput,
} from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";
import { NetworkError, type RequestError } from "../../../shared/api/problem.js";
import { useOfflineQueue } from "../../../shared/lib/queue-context.js";

/** Mirrors the API's ResourceView. */
export interface Resource {
  readonly id: string;
  readonly type: ResourceType;
  readonly title: string;
  readonly author: string | null;
  readonly url: string | null;
  readonly status: ResourceStatus;
  readonly abandonReason: string | null;
  readonly progress: ResourceProgress | null;
  /** Null, never 0, when it cannot be computed — the two are different claims. */
  readonly fraction: number | null;
  readonly isMeasurable: boolean;
  readonly addedAt: string;
  readonly finishedAt: string | null;
}

export const resourceKeys = {
  all: ["resources"] as const,
  list: (query: ListResourcesQuery) =>
    ["resources", "list", query.status ?? "", query.type ?? ""] as const,
};

function toSearch(query: ListResourcesQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.type) params.set("type", query.type);
  if (query.missionId) params.set("missionId", query.missionId);
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

export function useResources(query: ListResourcesQuery): UseQueryResult<{ resources: Resource[] }> {
  return useQuery({
    queryKey: resourceKeys.list(query),
    queryFn: ({ signal }) =>
      api.get<{ resources: Resource[] }>(`/resources${toSearch(query)}`, signal),
  });
}

/**
 * The capture body, minted here so the mutation's *variables* are the exact request.
 *
 * The id matters more than usual on this path: it is what makes a replay from the offline queue the
 * same resource rather than a second copy, and re-deriving it on retry would throw that away.
 */
export function captureBody(input: {
  url: string;
  missionId?: string | null;
}): CaptureResourceInput {
  return {
    id: crypto.randomUUID(),
    url: input.url,
    ...(input.missionId == null ? {} : { missionId: input.missionId }),
  };
}

/**
 * FR-R2 — the make-or-break path, so it behaves like the other captures: fire-and-forget, queued when
 * the request never arrives.
 *
 * Not rolled back on a network failure. The URL is the thing worth keeping, and a paste that visibly
 * fails is a paste you have to remember to do again — which is exactly the friction this replaces.
 */
export function useCaptureResource(): UseMutationResult<
  Resource,
  RequestError,
  CaptureResourceInput
> {
  const queryClient = useQueryClient();
  const offline = useOfflineQueue();

  return useMutation({
    mutationFn: (body) => api.post<Resource>("/resources/capture", body),
    onError: (error, body) => {
      if (error instanceof NetworkError && offline && body.id) {
        void offline.queue.enqueue(`resource:${body.id}`, "/resources/capture", body);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: resourceKeys.all }),
  });
}

export function useAddResource(): UseMutationResult<Resource, RequestError, CreateResourceInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body) => api.post<Resource>("/resources", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: resourceKeys.all }),
  });
}

/**
 * A capture path too (§5.1): you close the book and mark the page from bed.
 *
 * Queued on a network failure like the others, and it needs no idempotency key to be safe — progress
 * is a position, so replaying "page 137" twice still lands on page 137.
 */
export function useMarkProgress(): UseMutationResult<
  Resource,
  RequestError,
  { id: string; patch: UpdateProgressInput }
> {
  const queryClient = useQueryClient();
  const offline = useOfflineQueue();

  return useMutation({
    mutationFn: ({ id, patch }) => api.patch<Resource>(`/resources/${id}/progress`, patch),
    onError: (error, { id, patch }) => {
      if (error instanceof NetworkError && offline) {
        void offline.queue.enqueue(`progress:${id}`, `/resources/${id}/progress`, patch, "PATCH");
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: resourceKeys.all }),
  });
}

/**
 * Triage, finishing, and abandoning are not captures — they are considered decisions about something
 * already saved, so a failure has to be visible rather than disappearing into the queue.
 */
export function useEditResource(): UseMutationResult<
  Resource,
  RequestError,
  { id: string; patch: UpdateResourceInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }) => api.patch<Resource>(`/resources/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: resourceKeys.all }),
  });
}

export function useFinishResource(): UseMutationResult<Resource, RequestError, { id: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }) => api.post<Resource>(`/resources/${id}/finish`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: resourceKeys.all }),
  });
}

export function useAbandonResource(): UseMutationResult<
  Resource,
  RequestError,
  { id: string; reason?: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }) =>
      api.post<Resource>(`/resources/${id}/abandon`, reason ? { reason } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: resourceKeys.all }),
  });
}
