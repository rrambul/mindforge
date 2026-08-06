import type { ResourceStatus, ResourceType } from "@mindforge/core";
import type { Resource } from "./resource.js";

export const RESOURCE_REPOSITORY = Symbol("ResourceRepository");

export interface ResourceFilter {
  readonly status?: ResourceStatus | undefined;
  readonly type?: ResourceType | undefined;
  readonly missionId?: string | undefined;
  readonly limit?: number | undefined;
}

/** What a resource is connected to. Empty arrays rather than nulls: "none" is a set, not an absence. */
export interface ResourceLinks {
  readonly missionIds: readonly string[];
  readonly skillIds: readonly string[];
}

export interface ResourceRepository {
  findById(userId: string, id: string): Promise<Resource | null>;
  /** For capture: the same URL twice is the same resource, not a duplicate (FR-R2). */
  findByUrl(userId: string, url: string): Promise<Resource | null>;
  list(userId: string, filter: ResourceFilter): Promise<Resource[]>;
  /** Upsert, with the mission link written in the same transaction when one is given. */
  save(userId: string, resource: Resource, missionId?: string | null): Promise<void>;

  /**
   * Links for a batch of resources, keyed by resource id.
   *
   * Batched because the library renders every resource with its links, and one query per card would
   * make a page load twenty round trips.
   */
  linksFor(
    userId: string,
    resourceIds: readonly string[],
  ): Promise<Readonly<Record<string, ResourceLinks>>>;

  /**
   * Replaces the whole link set in one transaction.
   *
   * A replacement rather than add/remove: the write is then idempotent, and a client that lost track of
   * what was linked cannot end up with a half-applied diff.
   */
  setLinks(userId: string, resourceId: string, links: ResourceLinks): Promise<void>;
}
