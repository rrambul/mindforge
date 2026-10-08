import {
  LearningRecordSchema,
  MissionBannerSchema,
  ReferenceDocSchema,
  type LearningRecord,
  type MissionBanner,
  type ReferenceDoc,
} from "@mindforge/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";

import { api } from "../../../shared/api/http.js";

/**
 * The two collections a teach workspace leaves behind (FR-T6).
 *
 * Reference docs are the artifacts the skill says you *revisit* — unlike lessons,
 * which you do once — so they get a library of their own rather than a filter on
 * the curriculum. Learning records are what you wrote down at the time, and they
 * are read next to the lesson they came out of.
 */

/** The API's own shapes, from `packages/core`. See `schemas/wire.ts`. */
export type { LearningRecord, ReferenceDoc };

/**
 * The two envelopes, declared here rather than in core.
 *
 * They are this feature's framing of shared rows — `expiresAt` is a fact about
 * *this list's* signed URLs, not about a reference document — so core owns the
 * item and the endpoint owns the wrapper.
 */
const ReferenceDocsResponseSchema = z.object({
  docs: z.array(ReferenceDocSchema),
  /** When every URL above stops working. They are signed and expire together. */
  expiresAt: z.iso.datetime().nullable(),
});

const LearningRecordsResponseSchema = z.object({
  records: z.array(LearningRecordSchema),
});

export const libraryKeys = {
  all: ["library"] as const,
  referenceDocs: (missionId: string) => ["library", "reference", missionId] as const,
  records: (missionId: string, lessonId?: string) =>
    ["library", "records", missionId, lessonId ?? null] as const,
  banner: (missionId: string) => ["library", "banner", missionId] as const,
};

/**
 * Twenty minutes against a thirty-minute grant. The URL is signed, so a fetch is a
 * new URL and a new download of the same picture; refetching on every focus would
 * redraw the top of the page for nothing. An image already drawn stays drawn after
 * its grant expires, and the next refetch lands well before a fresh mount could
 * be handed a dead one.
 */
const BANNER_STALE_MS = 20 * 60 * 1000;

/** The mission's banner (FR-T10): a signed URL, or null when there is none. */
export function useMissionBanner(missionId: string): UseQueryResult<MissionBanner> {
  return useQuery({
    queryKey: libraryKeys.banner(missionId),
    queryFn: ({ signal }) => api.get(`/missions/${missionId}/banner`, MissionBannerSchema, signal),
    staleTime: BANNER_STALE_MS,
  });
}

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
      api.get(`/missions/${missionId}/reference-docs`, ReferenceDocsResponseSchema, signal),
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
      api.get(
        `/missions/${missionId}/learning-records${query}`,
        LearningRecordsResponseSchema,
        signal,
      ),
  });
}
