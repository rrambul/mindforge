import { LessonViewSchema, type LessonOutcome, type LessonView } from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { api } from "../../../shared/api/http.js";
import { curriculumKeys } from "../../../shared/api/query-keys.js";

/**
 * One lesson, and the URL that opens it (FR-T5, FR-P1).
 *
 * The API's own shape, from `packages/core` — this used to be a hand-written copy
 * headed by "Mirrors `LessonView` in the API's `lesson.view.ts`", which was the
 * only thing holding the two together. `view` is null when there is nothing to
 * open: a planned lesson has no file, which is a state and not a failure.
 */
export type Lesson = LessonView;

export const lessonKeys = {
  all: ["lesson"] as const,
  byId: (lessonId: string) => ["lesson", lessonId] as const,
};

/**
 * **`staleTime: 0`, and the URL is the reason.**
 *
 * Every fetch mints a fresh grant that expires in half an hour, so a cached
 * response is a URL with a shrinking amount of life left in it. Refetching on
 * mount is the cheap way to be sure the frame that is about to render has a grant
 * good for the whole lesson; the response is a few hundred bytes.
 *
 * What must *not* happen is a refetch while you are reading. `refetchOnWindowFocus`
 * is off for this query: a new URL is a new `src`, and swapping it reloads the
 * document and throws away whatever state the lesson's own JavaScript was holding
 * — which for a simulator is the entire lesson.
 */
export function useLesson(lessonId: string): UseQueryResult<Lesson> {
  return useQuery({
    queryKey: lessonKeys.byId(lessonId),
    queryFn: ({ signal }) => api.get(`/lessons/${lessonId}`, LessonViewSchema, signal),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

/**
 * Understood, shaky or lost (FR-P1).
 *
 * Both writes invalidate the curriculum as well as the lesson, because the number
 * this changes is on the other screen: the module's fraction, its outcome chip and
 * which lesson is badged next all move the moment an outcome lands. Leaving that
 * out is how a learner marks a lesson done, goes back, and sees the plan claim it
 * is not.
 */
export function useCompleteLesson(
  lessonId: string,
): UseMutationResult<Lesson, Error, LessonOutcome> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (outcome: LessonOutcome) =>
      api.put(`/lessons/${lessonId}/completion`, LessonViewSchema, { outcome }),
    onSuccess: (lesson) => {
      queryClient.setQueryData(lessonKeys.byId(lessonId), lesson);
      void queryClient.invalidateQueries({ queryKey: curriculumKeys.ofMission(lesson.missionId) });
    },
  });
}

/**
 * Undo a mis-tap.
 *
 * Not "reset my progress": the outcome you record stays until you record another
 * one, and nothing decays with time (non-negotiable 10). A three-button tray on a
 * phone earns an undo; a bad week does not.
 */
export function useClearCompletion(lessonId: string): UseMutationResult<Lesson, Error, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete(`/lessons/${lessonId}/completion`, LessonViewSchema),
    onSuccess: (lesson) => {
      queryClient.setQueryData(lessonKeys.byId(lessonId), lesson);
      void queryClient.invalidateQueries({ queryKey: curriculumKeys.ofMission(lesson.missionId) });
    },
  });
}
