import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import {
  LIBRARY_READER,
  type LearningRecordRow,
  type LibraryReader,
  type ReferenceDocRow,
} from "./library.port.js";
import { ViewGrants, viewUrlFor } from "./view-grants.js";

/**
 * The reference library and the learning records (FR-T6).
 *
 * **One grant for the whole list.** A view grant covers a workspace prefix, not a
 * file, so a library of thirty documents needs one signature rather than thirty —
 * and every URL in the list expires together, which is also what the reader wants:
 * the page either works or is refreshed, never half of each.
 */
export interface ReferenceDocView extends ReferenceDocRow {
  /** Null when the path is not under the mission's prefix, which nothing writes. */
  readonly url: string | null;
}

export interface ReferenceLibraryView {
  readonly docs: readonly ReferenceDocView[];
  /** When every URL above stops working. Null when there is nothing to open. */
  readonly expiresAt: Date | null;
}

@Injectable()
export class ReadReferenceLibrary {
  constructor(
    @Inject(LIBRARY_READER) private readonly library: LibraryReader,
    private readonly grants: ViewGrants,
  ) {}

  async execute(userId: string, missionId: string): Promise<ReferenceLibraryView> {
    const found = await this.library.referenceDocs(userId, missionId);
    if (found === null) throw new NotFoundException("mission_not_found");

    // A mission with no workspace key has never been materialised, so it has no
    // reference docs either — and minting a grant for a prefix that does not exist
    // would hand out a working token for an empty directory.
    if (found.workspaceKey === null || found.referenceDocs.length === 0) {
      return { docs: found.referenceDocs.map((doc) => ({ ...doc, url: null })), expiresAt: null };
    }

    const grant = await this.grants.mint(userId, found.workspaceKey);

    return {
      docs: found.referenceDocs.map((doc) => ({
        ...doc,
        url: viewUrlFor(grant, doc.storagePath),
      })),
      expiresAt: grant.expiresAt,
    };
  }
}

@Injectable()
export class ReadLearningRecords {
  constructor(@Inject(LIBRARY_READER) private readonly library: LibraryReader) {}

  async execute(
    userId: string,
    missionId: string,
    lessonId?: string,
  ): Promise<readonly LearningRecordRow[]> {
    const records = await this.library.learningRecords(userId, missionId, lessonId);
    if (records === null) throw new NotFoundException("mission_not_found");

    return records;
  }
}
