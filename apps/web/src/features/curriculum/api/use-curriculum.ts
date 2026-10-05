import {
  CurriculumViewSchema,
  type CurriculumLesson,
  type CurriculumModule,
  type CurriculumView,
} from "@mindforge/core";
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

/**
 * The API's own shapes, from `packages/core` — not copies of them.
 *
 * These were three hand-written mirrors, each headed by a comment naming the
 * server declaration it tracked, with nothing checking they still matched. The
 * response is now parsed against the same schema the API derives its return type
 * from, so a field renamed on the server fails here with that field's name rather
 * than arriving as `undefined` in a panel.
 *
 * Re-exported under the names this feature already used, because
 * `CurriculumLesson` reads better than `LessonView` beside `CurriculumModule`.
 */
export type { CurriculumLesson, CurriculumModule };
export type Curriculum = CurriculumView;

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
    queryFn: ({ signal }) =>
      api.get(`/missions/${missionId}/curriculum`, CurriculumViewSchema, signal),
    staleTime: 0,
  });
}
