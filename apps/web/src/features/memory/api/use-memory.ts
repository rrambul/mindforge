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
 * What the agent has concluded about you (§7.6).
 *
 * Read, confirm, forget. There is no create, and its absence is the design:
 * §7.6 says not to build an onboarding questionnaire, because what people say up
 * front about how they learn is usually wrong. The memory is what the agent
 * noticed across sessions, and your job is to correct it rather than seed it.
 */

export type MemoryKind = "background" | "teaching_preference" | "learning_pattern" | "constraint";

export interface MemoryView {
  readonly id: string;
  readonly slug: string;
  readonly kind: MemoryKind;
  /** The file's one-line summary — one fact, stated plainly. */
  readonly summary: string;
  /** `agent` or `user`. Almost always the former. */
  readonly writtenBy: string;
  /** Null means "you have not reviewed this", never "it is wrong". */
  readonly confirmedAt: string | null;
  /** Set when the agent later changed its mind. The old entry is kept. */
  readonly supersededBySlug: string | null;
  readonly updatedAt: string;
}

export const memoryKeys = { all: ["memory"] as const };

export function useMemories(): UseQueryResult<MemoryView[], RequestError> {
  return useQuery<MemoryView[], RequestError>({
    queryKey: memoryKeys.all,
    queryFn: () => api.get<MemoryView[]>("/me/memory"),
  });
}

export function useConfirmMemory(): UseMutationResult<MemoryView, RequestError, string> {
  const queryClient = useQueryClient();

  return useMutation<MemoryView, RequestError, string>({
    mutationFn: (id) => api.post<MemoryView>(`/me/memory/${id}/confirm`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memoryKeys.all });
    },
  });
}

/**
 * Delete a memory outright.
 *
 * Not queued offline. The server also deletes the file, and a replay on reconnect
 * would be a second delete of something already gone — but more to the point, a
 * decision to remove what a model believes about you is one worth seeing fail
 * rather than silently retrying later.
 */
export function useForgetMemory(): UseMutationResult<void, RequestError, string> {
  const queryClient = useQueryClient();

  return useMutation<void, RequestError, string>({
    mutationFn: (id) => api.delete<void>(`/me/memory/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memoryKeys.all });
    },
  });
}
