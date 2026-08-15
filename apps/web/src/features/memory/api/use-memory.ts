import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { MemoryViewSchema, type MemoryView } from "@mindforge/core";
import { z } from "zod";

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

/**
 * The four kinds the UI has copy for.
 *
 * Kept as a client-side list rather than as the wire type, and `MemoryView.kind`
 * is a bare string on purpose: the agent writes these files and the parser stores
 * what it finds, so a fifth kind must still reach the screen. Rejecting the
 * response would hide the whole list over one unfamiliar word.
 */
export const MEMORY_KINDS_WITH_COPY = [
  "background",
  "teaching_preference",
  "learning_pattern",
  "constraint",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS_WITH_COPY)[number];

/** The API's own shape, from `packages/core`. */
export type { MemoryView };

export const memoryKeys = { all: ["memory"] as const };

export function useMemories(): UseQueryResult<MemoryView[], RequestError> {
  return useQuery<MemoryView[], RequestError>({
    queryKey: memoryKeys.all,
    queryFn: () => api.get("/me/memory", z.array(MemoryViewSchema)),
  });
}

export function useConfirmMemory(): UseMutationResult<MemoryView, RequestError, string> {
  const queryClient = useQueryClient();

  return useMutation<MemoryView, RequestError, string>({
    mutationFn: (id) => api.post(`/me/memory/${id}/confirm`, MemoryViewSchema),
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
    mutationFn: (id) => api.delete(`/me/memory/${id}`, z.void()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memoryKeys.all });
    },
  });
}
