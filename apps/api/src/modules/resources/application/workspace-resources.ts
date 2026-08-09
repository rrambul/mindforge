import type { ParsedRejection, ParsedResource } from "@mindforge/workspace";
import { Inject, Injectable } from "@nestjs/common";

import {
  WORKSPACE_RESOURCE_WRITER,
  type WorkspaceResourceWriter,
} from "../domain/workspace-resource.writer.js";

/**
 * `RESOURCES.md` → the resource library (FR-T8).
 *
 * In the resources module rather than in `teach`, because whoever owns the table
 * owns the write (§2.1 decision 2) — and because the decision this makes is a
 * resources decision, not a teach one.
 *
 * ### The upsert key, decided here and once
 *
 * `resources` has no natural unique constraint, and the agent rewrites
 * `RESOURCES.md` wholesale on every run. Without a key, the second run doubles
 * the library and the tenth makes it useless.
 *
 * **Normalised URL first, normalised title as the fallback.** A URL is the only
 * thing about a resource that is genuinely an identity: two entries pointing at
 * the same page are the same book whatever they are called, and an agent that
 * rewrites "The Rust Book" as "The Rust Programming Language" between runs is
 * doing something reasonable that must not create a second row. Title-matching
 * alone would merge two different papers that share a name; URL-matching alone
 * would duplicate every podcast and book the agent listed without one. Both, in
 * that order, is the shape that survives the way agents actually write.
 *
 * ### What this must never write
 *
 * `status`, `progress`, `finished_at` and `abandon_reason`. **`RESOURCES.md` has
 * no status column at all**, and the database defaults `status` to `inbox` — so a
 * naive write of a parsed resource silently resets a book the learner marked
 * `finished`, on every run, forever. That is the single most damaging thing this
 * file could do, and the reason it goes through a writer whose interface cannot
 * express those columns rather than through `EditResource`.
 *
 * It also does not go through the `Resource` entity. Every rule that entity
 * protects is about keeping *status* honest, and this path touches none of it —
 * putting the write there would mean adding methods whose only job is to not use
 * the invariants around them.
 */

export interface WorkspaceResourcesInput {
  readonly userId: string;
  readonly missionId: string;
  readonly primary: readonly ParsedResource[];
  readonly rejected: readonly ParsedRejection[];
}

export interface WorkspaceResourcesResult {
  readonly created: number;
  readonly updated: number;
}

/**
 * Strip what does not identify a page: scheme, `www.`, a trailing slash, the
 * fragment, and the tracking parameters that make one link three.
 *
 * Deliberately not stripping every query parameter — `?v=` on a video and `?p=`
 * on a forum thread *are* the identity, and merging on them would collapse a
 * playlist into one row.
 */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|ref$|ref_src$|si$)/u;

export function normalizeUrl(url: string | null): string | null {
  if (url === null || url.trim() === "") return null;

  try {
    const parsed = new URL(url.trim());
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
    }
    const host = parsed.host.replace(/^www\./u, "");
    const path = parsed.pathname.replace(/\/$/u, "");
    return `${host}${path}${parsed.search}`.toLowerCase();
  } catch {
    // Not a URL the platform can parse. Compared as written rather than
    // discarded — an agent writing a bare `doc.rust-lang.org/book` should still
    // match itself between runs.
    return url.trim().toLowerCase();
  }
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/gu, " ").toLowerCase();
}

@Injectable()
export class SyncWorkspaceResources {
  constructor(
    @Inject(WORKSPACE_RESOURCE_WRITER) private readonly writer: WorkspaceResourceWriter,
  ) {}

  async execute(input: WorkspaceResourcesInput): Promise<WorkspaceResourcesResult> {
    const existing = await this.writer.existingKeys(input.userId);

    let created = 0;
    let updated = 0;

    const seen = new Set<string>();

    for (const resource of input.primary) {
      const url = normalizeUrl(resource.url);
      const title = normalizeTitle(resource.title);
      const key = url ?? title;

      // Within one file too, not just against the database. An agent that lists
      // the same book twice should not produce two rows on the first run either.
      if (seen.has(key)) continue;
      seen.add(key);

      const match =
        (url !== null ? existing.byUrl.get(url) : undefined) ?? existing.byTitle.get(title);

      if (match) {
        await this.writer.updateFromWorkspace(input.userId, input.missionId, match, {
          title: resource.title,
          url: resource.url,
          type: resource.type,
          trust: resource.trust,
        });
        updated += 1;
      } else {
        await this.writer.createFromWorkspace(input.userId, input.missionId, {
          title: resource.title,
          url: resource.url,
          type: resource.type,
          trust: resource.trust,
        });
        created += 1;
      }
    }

    for (const rejection of input.rejected) {
      const url = normalizeUrl(rejection.url);
      const title = normalizeTitle(rejection.title);
      const match =
        (url !== null ? existing.byUrl.get(url) : undefined) ?? existing.byTitle.get(title);

      // A rejection records a judgement about something nobody started, so it
      // writes `rejected_reason` and nothing else. **Never `abandon_reason`** —
      // that is the learner's own guilt-free quit (FR-R5) and prime friction
      // data, and writing the agent's verdict into it would invent an
      // abandonment that never happened.
      if (match) {
        await this.writer.rejectExisting(input.userId, input.missionId, match, rejection.reason);
        updated += 1;
      } else {
        await this.writer.createRejected(input.userId, input.missionId, {
          title: rejection.title,
          url: rejection.url,
          reason: rejection.reason,
        });
        created += 1;
      }
    }

    return { created, updated };
  }
}
