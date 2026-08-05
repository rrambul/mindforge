import type { ResourceStatus, ResourceType } from "@mindforge/core";
import type { Resource } from "./resource.js";

export const RESOURCE_REPOSITORY = Symbol("ResourceRepository");

export interface ResourceFilter {
  readonly status?: ResourceStatus | undefined;
  readonly type?: ResourceType | undefined;
  readonly missionId?: string | undefined;
  readonly limit?: number | undefined;
}

export interface ResourceRepository {
  findById(userId: string, id: string): Promise<Resource | null>;
  /** For capture: the same URL twice is the same resource, not a duplicate (FR-R2). */
  findByUrl(userId: string, url: string): Promise<Resource | null>;
  list(userId: string, filter: ResourceFilter): Promise<Resource[]>;
  /** Upsert, with the mission link written in the same transaction when one is given. */
  save(userId: string, resource: Resource, missionId?: string | null): Promise<void>;
}
