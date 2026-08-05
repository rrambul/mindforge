import {
  RESOURCE_STATUSES,
  RESOURCE_TYPES,
  ResourceProgressSchema,
  type ResourceProgress,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { Resource, type ResourceSnapshot } from "../domain/resource.js";
import type { ResourceFilter, ResourceRepository } from "../domain/resource.repository.js";

interface ResourceRow {
  id: string;
  userId: string;
  type: string;
  title: string;
  author: string | null;
  url: string | null;
  status: string;
  abandonReason: string | null;
  progress: unknown;
  addedAt: Date;
  finishedAt: Date | null;
}

const COLUMNS = {
  id: true,
  userId: true,
  type: true,
  title: true,
  author: true,
  url: true,
  status: true,
  abandonReason: true,
  progress: true,
  addedAt: true,
  finishedAt: true,
} as const;

@Injectable()
export class PrismaResourceRepository implements ResourceRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  findById(userId: string, id: string): Promise<Resource | null> {
    return this.db.run(userId, async (tx) => {
      const row = await tx.resource.findUnique({ where: { id }, select: COLUMNS });
      return row ? toResource(row) : null;
    });
  }

  findByUrl(userId: string, url: string): Promise<Resource | null> {
    return this.db.run(userId, async (tx) => {
      // No unique index on (user_id, url): a URL is not a natural key — the same article can legitimately
      // be re-added after being abandoned, and a constraint would turn that into an error. Dedupe is a
      // capture-time courtesy, so the newest match is the one to return.
      const row = await tx.resource.findFirst({
        where: { url },
        orderBy: { addedAt: "desc" },
        select: COLUMNS,
      });
      return row ? toResource(row) : null;
    });
  }

  list(userId: string, filter: ResourceFilter): Promise<Resource[]> {
    return this.db.run(userId, async (tx) => {
      const rows = await tx.resource.findMany({
        where: {
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.type ? { type: filter.type } : {}),
          // Through the link table, which is how a resource belongs to a mission (FR-R3).
          ...(filter.missionId ? { links: { some: { missionId: filter.missionId } } } : {}),
        },
        orderBy: { addedAt: "desc" },
        ...(filter.limit === undefined ? {} : { take: filter.limit }),
        select: COLUMNS,
      });
      // Status precedence is applied by the caller via resourceStatusRank — ordering a text column in
      // SQL is alphabetical, which is the same trap missions fell into.
      return rows.map(toResource);
    });
  }

  async save(userId: string, resource: Resource, missionId?: string | null): Promise<void> {
    const r = resource.toSnapshot();

    const mutable = {
      type: r.type,
      title: r.title,
      author: r.author,
      status: r.status,
      abandonReason: r.abandonReason,
      progress: r.progress ?? {},
      finishedAt: r.finishedAt,
    };

    await this.db.run(userId, async (tx) => {
      await tx.resource.upsert({
        where: { id: r.id },
        create: {
          id: r.id,
          userId: r.userId,
          url: r.url,
          addedAt: r.addedAt,
          ...mutable,
        },
        // `url` and `addedAt` are set once: a resource does not become a different URL, and when it
        // arrived is a fact about the capture.
        update: mutable,
      });

      if (missionId) {
        // In the same transaction as the resource, so a captured-to-a-mission resource can never exist
        // unlinked — the link is the reason FR-R3 says an article you never connect to a goal is
        // entertainment.
        await tx.resourceLink.createMany({
          data: [{ userId: r.userId, resourceId: r.id, missionId }],
          skipDuplicates: true,
        });
      }
    });
  }
}

function toResource(row: ResourceRow): Resource {
  return Resource.fromSnapshot(toSnapshot(row));
}

function toSnapshot(row: ResourceRow): ResourceSnapshot {
  return {
    id: row.id,
    userId: row.userId,
    // Free-text columns with no check constraint, narrowed at the one boundary where a row becomes an
    // entity rather than trusted.
    type: narrow(row.type, RESOURCE_TYPES, "type"),
    title: row.title,
    author: row.author,
    url: row.url,
    status: narrow(row.status, RESOURCE_STATUSES, "status"),
    abandonReason: row.abandonReason,
    progress: toProgress(row.progress),
    addedAt: row.addedAt,
    finishedAt: row.finishedAt,
  };
}

/**
 * Progress is JSONB and defaults to `{}`, so "no progress" and "a shape we no longer understand" both
 * arrive here. Both become null: a resource whose position cannot be read is still a resource worth
 * seeing, and throwing would hide the whole library over one bad row.
 */
function toProgress(value: unknown): ResourceProgress | null {
  if (value === null || value === undefined) return null;
  const parsed = ResourceProgressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function narrow<T extends string>(value: string, allowed: readonly T[], column: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`resources.${column} has unknown value "${value}"`);
  }
  return value as T;
}
