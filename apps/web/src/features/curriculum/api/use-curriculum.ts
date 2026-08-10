import type { LessonDepth, LessonStatus, ModuleProgress } from "@mindforge/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { api } from "../../../shared/api/http.js";
import { curriculumKeys } from "../../../shared/api/query-keys.js";

/**
 * A mission's curriculum (FR-K5).
 *
 * Every derived field here was computed on the server by `packages/core` —
 * locked, fundamental, the fraction, what is next — and nothing in this feature
 * recomputes one. The SPA *could* import the same functions, and that is exactly
 * why it must not do it twice: two call sites drift, and a screen that disagreed
 * with the API about what is unblocked would be the product's central promise
 * breaking quietly (non-negotiable 3).
 */

/** Mirrors `LessonView` in the API's `get-curriculum.ts`. */
export interface CurriculumLesson {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly intent: string | null;
  readonly status: LessonStatus;
  /** 1–5 for this learner. Null means the plan did not say — rendered as unknown. */
  readonly difficulty: number | null;
  readonly depth: LessonDepth | null;
  readonly completed: boolean;
  readonly outcome: string | null;
  readonly unblocked: boolean;
  /** Titles of the prerequisites still unfinished, so the lock reads as a sentence. */
  readonly blockedBy: readonly string[];
  /** How many lessons depend on this one (FR-K6). */
  readonly dependentCount: number;
}

/** Mirrors `ModuleView`. */
export interface CurriculumModule {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly outcome: string | null;
  readonly status: string;
  readonly prerequisites: readonly string[];
  /** Null when the module has no lessons at all. Not a zero — see the panel. */
  readonly progress: ModuleProgress | null;
  readonly lessons: readonly CurriculumLesson[];
}

export interface Curriculum {
  readonly missionId: string;
  readonly modules: readonly CurriculumModule[];
  readonly nextLessonId: string | null;
}

/**
 * In `shared/api` rather than here, because the reader invalidates it: recording a
 * lesson's outcome moves this screen's fractions, chips and "next" badge, and a
 * feature may not import another feature's `api/` to say so (§2.2 rule 6).
 */
export { curriculumKeys } from "../../../shared/api/query-keys.js";

/**
 * Not cached past its query.
 *
 * A teach run rewrites this while the screen is open, and the one thing the
 * screen exists to answer — what to do next — is the first thing that changes.
 */
export function useCurriculum(missionId: string): UseQueryResult<Curriculum> {
  return useQuery({
    queryKey: curriculumKeys.ofMission(missionId),
    queryFn: ({ signal }) => api.get<Curriculum>(`/missions/${missionId}/curriculum`, signal),
    staleTime: 0,
  });
}
