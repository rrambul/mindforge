import type { MissionStatus } from "@mindforge/core";
import type { Mission, MissionRevisionDraft } from "./mission.js";

export const MISSION_REPOSITORY = Symbol("MissionRepository");

/**
 * `| undefined` is spelled out because `exactOptionalPropertyTypes` is on: without
 * it, "no filter" and "filter by undefined" are different types, and callers
 * forwarding an optional query would not compile.
 */
export interface MissionFilter {
  readonly status?: MissionStatus | undefined;
}

/**
 * `userId` is first on every method, always.
 *
 * Not redundant with RLS, and not ambient state: the worker will hold a
 * service-role connection that bypasses policies entirely (TECH-DESIGN.md §3.6),
 * and this signature is what makes forgetting to scope a query a compile error
 * rather than a cross-user leak. It is CLAUDE.md's first non-negotiable, expressed
 * in the type system.
 */
export interface MissionRepository {
  findById(userId: string, id: string): Promise<Mission | null>;

  list(userId: string, filter: MissionFilter): Promise<Mission[]>;

  /** The WIP-limit read (FR-M4). A count, not a list — the limit is all we need. */
  countActive(userId: string): Promise<number>;

  create(userId: string, mission: Mission): Promise<void>;

  /**
   * Persists the mission and appends the revision **atomically**.
   *
   * One method rather than two calls because FR-M2's history has to be complete
   * to mean anything. A mission saved without its revision is drift that silently
   * did not happen, and it would be invisible — the mission still looks right.
   */
  update(userId: string, mission: Mission, revision: MissionRevisionDraft | null): Promise<void>;
}
