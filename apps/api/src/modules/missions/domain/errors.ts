import {
  DomainError,
  MISSION_WIP_LIMIT,
  type DomainErrorKind,
  type ServerMessageKey,
} from "@mindforge/core";

/**
 * The rules a mission protects, as errors.
 *
 * Each names a `kind` rather than a status code — `shared/http` turns that into
 * HTTP, so this file has no idea what a 409 is (TECH-DESIGN.md §2.1).
 */

/**
 * FR-M4. The `slug` is the reason this is not just "a 409": the SPA branches on
 * it to offer *park something* inline, which no other conflict wants.
 */
export class WipLimitReached extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "wip-limit-reached";
  readonly detailKey: ServerMessageKey = "error.mission.wip_limit";
  override readonly detailVars: { readonly limit: number };

  constructor(limit: number = MISSION_WIP_LIMIT) {
    super(`WIP limit of ${limit} active missions reached`);
    this.detailVars = { limit };
  }
}

export class MissionNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "mission-not-found";
  readonly detailKey: ServerMessageKey = "error.mission.not_found";

  constructor(id: string) {
    // RLS makes "not yours" and "does not exist" the same observation here, and
    // that is the right answer to give: distinguishing them would confirm that
    // some other user owns this id.
    super(`Mission ${id} not found`);
  }
}

export class MissionNotActive extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "mission-not-active";
  readonly detailKey: ServerMessageKey = "error.mission.not_active";

  constructor(status: string) {
    super(`Only an active mission can be parked; this one is ${status}`);
  }
}

export class MissionNotParked extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "mission-not-parked";
  readonly detailKey: ServerMessageKey = "error.mission.not_parked";

  constructor(status: string) {
    super(`Only a parked mission can be resumed; this one is ${status}`);
  }
}
