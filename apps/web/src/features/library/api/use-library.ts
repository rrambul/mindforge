import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { api } from "../../../shared/api/http.js";

/**
 * The two collections a teach workspace leaves behind (FR-T6).
 *
 * Reference docs are the artifacts the skill says you *revisit* — unlike lessons,
 * which you do once — so they get a library of their own rather than a filter on
 * the curriculum. Learning records are what you wrote down at the time, and they
 * are read next to the lesson they came out of.
 */

export interface ReferenceDoc {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly updatedAt: string;
  /** Null when the mission has no workspace yet — there is nothing to open. */
  readonly url: string | null;
}

export interface LearningRecord {
  readonly id: string;
  readonly seq: number;
  readonly title: string;
  readonly lessonId: string | null;
  readonly lessonTitle: string | null;
  readonly whatLearned: string;
  readonly evidence: string | null;
  readonly keyInsight: string | null;
  readonly struggles: string | null;
  readonly next: string | null;
  readonly recordedAt: string;
}

export const libraryKeys = {
  all: ["library"] as const,
  referenceDocs: (missionId: string) => ["library", "reference", missionId] as const,
  records: (missionId: string, lessonId?: string) =>
    ["library", "records", missionId, lessonId ?? null] as const,
};

/**
 * `staleTime: 0`, for the same reason the lesson query has it: every URL in the
 * list is signed and expires together, so a list served from cache is a list of
 * links with a shrinking amount of life left in them.
 */
export function useReferenceDocs(missionId: string): UseQueryResult<{
  docs: readonly ReferenceDoc[];
  expiresAt: string | null;
}> {
  return useQuery({
    queryKey: libraryKeys.referenceDocs(missionId),
    queryFn: ({ signal }) =>
      api.get<{ docs: readonly ReferenceDoc[]; expiresAt: string | null }>(
        `/missions/${missionId}/reference-docs`,
        signal,
      ),
    staleTime: 0,
  });
}

/**
 * Records for a mission, or for one lesson of it.
 *
 * The filter is what links a record to the lesson it came out of (FR-T6) — the
 * reader asks for one lesson's, and the library screen asks for all of them.
 */
export function useLearningRecords(
  missionId: string,
  lessonId?: string,
): UseQueryResult<{ records: readonly LearningRecord[] }> {
  const query = lessonId === undefined ? "" : `?lessonId=${lessonId}`;

  return useQuery({
    queryKey: libraryKeys.records(missionId, lessonId),
    queryFn: ({ signal }) =>
      api.get<{ records: readonly LearningRecord[] }>(
        `/missions/${missionId}/learning-records${query}`,
        signal,
      ),
  });
}
