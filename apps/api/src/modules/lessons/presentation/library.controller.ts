import { UuidSchema } from "@mindforge/core";
import { Controller, Get, Header, Param, Query } from "@nestjs/common";
import { z } from "zod";

import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import { ReadLearningRecords, ReadReferenceLibrary } from "../application/read-library.js";

/**
 * `/v1/missions/:id/reference-docs` and `/v1/missions/:id/learning-records` (FR-T6).
 *
 * Under the mission, unlike the reader: neither collection means anything without
 * one, and a top-level list of every reference doc you own across every topic is a
 * shelf rather than a library.
 *
 * Two endpoints rather than one envelope, because they are read at different
 * times: the library screen wants the documents, and the reader wants the records
 * for the one lesson it is showing.
 */
const RecordsQuerySchema = z.object({ lessonId: UuidSchema.optional() });
type RecordsQuery = z.infer<typeof RecordsQuerySchema>;

export interface ReferenceDocResponse {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly updatedAt: string;
  /** Null when there is nothing to open — the mission has no workspace yet. */
  readonly url: string | null;
}

export interface LearningRecordResponse {
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

@Controller("missions")
export class LibraryController {
  constructor(
    private readonly reference: ReadReferenceLibrary,
    private readonly records: ReadLearningRecords,
  ) {}

  /**
   * Every URL in the list is signed and expires together, so this response must
   * not be cached — the reason `GET /v1/lessons/:id` gives, one list up.
   */
  @Get(":missionId/reference-docs")
  @Header("Cache-Control", "no-store")
  async docs(
    @CurrentUser() user: RequestContext,
    @Param("missionId", zodPipe(UuidSchema)) missionId: string,
  ): Promise<{ docs: readonly ReferenceDocResponse[]; expiresAt: string | null }> {
    const library = await this.reference.execute(user.userId, missionId);

    return {
      docs: library.docs.map((doc) => ({
        id: doc.id,
        slug: doc.slug,
        title: doc.title,
        updatedAt: doc.updatedAt.toISOString(),
        url: doc.url,
      })),
      expiresAt: library.expiresAt?.toISOString() ?? null,
    };
  }

  @Get(":missionId/learning-records")
  async learningRecords(
    @CurrentUser() user: RequestContext,
    @Param("missionId", zodPipe(UuidSchema)) missionId: string,
    @Query(zodPipe(RecordsQuerySchema)) query: RecordsQuery,
  ): Promise<{ records: readonly LearningRecordResponse[] }> {
    const rows = await this.records.execute(user.userId, missionId, query.lessonId);

    return {
      records: rows.map((row) => ({
        id: row.id,
        seq: row.seq,
        title: row.title,
        lessonId: row.lessonId,
        lessonTitle: row.lessonTitle,
        whatLearned: row.whatLearned,
        evidence: row.evidence,
        keyInsight: row.keyInsight,
        struggles: row.struggles,
        next: row.next,
        recordedAt: row.recordedAt.toISOString(),
      })),
    };
  }
}
