import type { BriefingInput } from "@mindforge/workspace";

export const BRIEFING_READER = Symbol("BriefingReader");

/**
 * Assembling what `BRIEFING.md` is rendered from (FR-T7).
 *
 * A reader rather than a repository, and a port rather than a query, because it
 * spans four modules' tables — missions, learning records, skills, friction — and
 * none of them owns the briefing. Reading them here rather than calling four use
 * cases is the pragmatic exception §2.1 allows for a read: nothing is written,
 * and a use case per table would be four round trips to build one file.
 *
 * **It returns `BriefingInput`, not a string.** The rendering is pure and lives in
 * `packages/workspace`, which is what lets a snapshot test pin the wording — and
 * the wording is the feature, since every untracked signal has to say so rather
 * than round to zero.
 */
export interface BriefingReader {
  /** Everything the briefing needs, with M3's absences already in place. */
  gather(userId: string, missionId: string): Promise<BriefingInput>;
}
