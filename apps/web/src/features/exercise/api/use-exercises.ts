import {
  ExerciseViewSchema,
  LessonExercisesViewSchema,
  type ExerciseView,
  type LessonExercisesView,
  type RecordAttemptInput,
  type ReportTaskInput,
  type RequestHintInput,
  type RequestReviewInput,
} from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { api } from "../../../shared/api/http.js";

/**
 * A lesson's exercises and what the learner has done with each (FR-X1–X6).
 *
 * The exercise itself comes from the lesson file, through the reindexer — the
 * server never invents one — and the attempt summary comes from the attempts the
 * learner recorded. One query for both, because the panel cannot render either
 * half without the other.
 */
export const exerciseKeys = {
  all: ["exercises"] as const,
  ofLesson: (lessonId: string) => ["exercises", lessonId] as const,
};

/**
 * `refetchOnWindowFocus` off for the same reason the lesson query turns it off:
 * nothing here changes behind your back, and a refetch while the editor is open
 * would re-seed it from `lastCode` the moment you tab back from the docs.
 */
export function useLessonExercises(lessonId: string): UseQueryResult<LessonExercisesView> {
  return useQuery({
    queryKey: exerciseKeys.ofLesson(lessonId),
    queryFn: ({ signal }) =>
      api.get(`/lessons/${lessonId}/exercises`, LessonExercisesViewSchema, signal),
    refetchOnWindowFocus: false,
  });
}

export interface RecordAttemptVariables {
  readonly key: string;
  readonly input: RecordAttemptInput;
}

/**
 * One run of the tests, recorded (FR-X5).
 *
 * The response is the exercise with its new summary, written straight into the
 * cached list rather than invalidating it: a refetch would be a second request for
 * a number the server just sent, and would briefly show the old count.
 */
export function useRecordAttempt(
  lessonId: string,
): UseMutationResult<ExerciseView, Error, RecordAttemptVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, input }: RecordAttemptVariables) =>
      api.post(`/lessons/${lessonId}/exercises/${key}/attempts`, ExerciseViewSchema, input),
    onSuccess: (exercise) => {
      writeExercise(queryClient, lessonId, exercise);
    },
  });
}

export interface RequestHintVariables {
  readonly key: string;
  readonly input: RequestHintInput;
}

/**
 * One rung of help (FR-H1). The response carries every hint so far and the next
 * rung allowed, so the ladder on screen is always the server's, never a count
 * kept here that could run ahead of what was actually given.
 */
export function useRequestHint(
  lessonId: string,
): UseMutationResult<ExerciseView, Error, RequestHintVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, input }: RequestHintVariables) =>
      api.post(`/lessons/${lessonId}/exercises/${key}/hints`, ExerciseViewSchema, input),
    onSuccess: (exercise) => {
      writeExercise(queryClient, lessonId, exercise);
    },
  });
}

export interface RequestReviewVariables {
  readonly key: string;
  readonly input: RequestReviewInput;
}

/**
 * A drawn design, sent for review (FR-X8). The review is the attempt — the server
 * records it — so the response is the exercise with its summary, its last results
 * and, after the first review, its rubric.
 */
export function useRequestReview(
  lessonId: string,
): UseMutationResult<ExerciseView, Error, RequestReviewVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, input }: RequestReviewVariables) =>
      api.post(`/lessons/${lessonId}/exercises/${key}/reviews`, ExerciseViewSchema, input),
    onSuccess: (exercise) => {
      writeExercise(queryClient, lessonId, exercise);
    },
  });
}

export interface ReportTaskVariables {
  readonly key: string;
  readonly input: ReportTaskInput;
}

/**
 * "I ran it" — a task's result, as the learner reports it. The server records it
 * as theirs (`graded_by = 'self'`), and the response is the exercise with the new
 * report in its summary.
 */
export function useReportTask(
  lessonId: string,
): UseMutationResult<ExerciseView, Error, ReportTaskVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, input }: ReportTaskVariables) =>
      api.post(`/lessons/${lessonId}/exercises/${key}/reports`, ExerciseViewSchema, input),
    onSuccess: (exercise) => {
      writeExercise(queryClient, lessonId, exercise);
    },
  });
}

/**
 * Opening an exercise's reference solution, recorded as help (review #4).
 *
 * Called before the solution is shown, and the panel shows it only once the reply
 * carries the `kind: "solution"` entry — so a reveal is never on screen without
 * being on record. The server writes it once per exercise however often it is asked.
 */
export function useRevealSolution(
  lessonId: string,
): UseMutationResult<ExerciseView, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (key: string) =>
      api.post(`/lessons/${lessonId}/exercises/${key}/solution-reveals`, ExerciseViewSchema, {}),
    onSuccess: (exercise) => {
      writeExercise(queryClient, lessonId, exercise);
    },
  });
}

/** Written straight into the cached list: a refetch would be a second request for what was just sent. */
function writeExercise(queryClient: QueryClient, lessonId: string, exercise: ExerciseView): void {
  queryClient.setQueryData<LessonExercisesView>(exerciseKeys.ofLesson(lessonId), (current) =>
    current === undefined
      ? current
      : {
          ...current,
          exercises: current.exercises.map((e) => (e.key === exercise.key ? exercise : e)),
        },
  );
}
