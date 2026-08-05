import type { ListMissionsQuery } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { MissionNotFound } from "../domain/errors.js";
import type { Mission } from "../domain/mission.js";
import { MISSION_REPOSITORY, type MissionRepository } from "../domain/mission.repository.js";

/**
 * Reads. Two of them, thin on purpose — there is no invariant to protect here, and
 * §2.1 is explicit that the ceremony is not the point.
 *
 * Deliberately unpaginated, against §6.1's "cursor-based on every list". A user has
 * at most three active missions by product rule (FR-M4) and realistically a few
 * dozen ever; a cursor here would be API surface protecting nothing. Resources,
 * notes, and focus sessions are the unbounded lists and they will get cursors.
 */
@Injectable()
export class ListMissions {
  constructor(@Inject(MISSION_REPOSITORY) private readonly missions: MissionRepository) {}

  execute(userId: string, query: ListMissionsQuery): Promise<Mission[]> {
    return this.missions.list(userId, query);
  }
}

@Injectable()
export class GetMission {
  constructor(@Inject(MISSION_REPOSITORY) private readonly missions: MissionRepository) {}

  async execute(userId: string, id: string): Promise<Mission> {
    const mission = await this.missions.findById(userId, id);
    if (!mission) throw new MissionNotFound(id);
    return mission;
  }
}
