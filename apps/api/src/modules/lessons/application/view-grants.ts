import { VIEW_GRANT_TTL_SECONDS, signViewToken } from "@mindforge/core";
import { workspacePrefix } from "@mindforge/workspace";
import { Inject, Injectable } from "@nestjs/common";

import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { LESSON_VIEW_CONFIG, type LessonViewConfig } from "./lesson-view.port.js";

/**
 * Turning "this file is yours" into a URL the lessons origin will serve (FR-T5).
 *
 * **One grant covers a whole workspace, not one file.** That is not a shortcut: a
 * lesson's own HTML links sideways to `../reference/x.html` and `../assets/y.png`,
 * and those requests arrive at the lessons origin carrying the same path prefix
 * the document was served under. A per-file grant would serve the document and
 * 404 every image in it.
 *
 * So the ownership test is per **mission**, done under RLS by whoever calls this,
 * and this class only knows how to sign the answer. It is deliberately not a
 * repository: nothing here reads, and the secret it holds has no business being
 * near a query.
 */
export interface ViewGrant {
  /** `https://lessons.example/v/<token>` — append a workspace-relative path. */
  readonly baseUrl: string;
  readonly expiresAt: Date;
}

@Injectable()
export class ViewGrants {
  constructor(
    @Inject(LESSON_VIEW_CONFIG) private readonly config: LessonViewConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async mint(userId: string, workspaceKey: string): Promise<ViewGrant> {
    const expiresAt = new Date(this.clock.now().getTime() + VIEW_GRANT_TTL_SECONDS * 1000);
    const token = await signViewToken(
      {
        prefix: workspacePrefix(userId, workspaceKey),
        // Whole seconds: the grant is not a stopwatch, and the two services have
        // to agree on the number down to its last digit.
        expiresAt: Math.floor(expiresAt.getTime() / 1000),
      },
      this.config.tokenSecret,
    );

    return {
      baseUrl: `${this.config.lessonsOrigin.replace(/\/$/u, "")}/v/${token}`,
      expiresAt,
    };
  }
}

/**
 * A full URL for one file inside a granted workspace.
 *
 * **`storagePath` is relative to the workspace**, exactly as the reindexer writes
 * it: `lessons/0001-a-plan-is-a-tree.html`, not
 * `workspaces/<user>/<key>/lessons/…`. That is the same shape the grant covers, so
 * the two compose without anything being stripped.
 *
 * This function used to strip an absolute prefix, because `TECH-DESIGN.md` §3.2
 * documented the column as absolute and both the seed and this module's own tests
 * wrote it that way — so every test agreed with the assumption and the first real
 * teach run rendered "there is no file behind this lesson" over a lesson that was
 * sitting in Storage.
 *
 * Each segment is encoded: a lesson written in Portuguese is `0003-café.html` on
 * disk (§5.2, FR-L3), and an unencoded accent is a request the lessons origin never
 * sees the right name for.
 */
export function viewUrlFor(grant: ViewGrant, storagePath: string): string {
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${grant.baseUrl}/${encoded}`;
}
