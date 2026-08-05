import { MISSION_WIP_LIMIT } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { MissionNotFound, WipLimitReached } from "../domain/errors.js";
import type { Mission } from "../domain/mission.js";
import { MISSION_REPOSITORY, type MissionRepository } from "../domain/mission.repository.js";

/**
 * FR-M4b. Parking is the pressure valve that makes the WIP limit livable — without
 * it the limit is just a wall, and the honest response to a wall is to stop using
 * the app.
 */
@Injectable()
export class ParkMission {
  constructor(
    @Inject(MISSION_REPOSITORY) private readonly missions: MissionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, id: string): Promise<Mission> {
    const mission = await this.missions.findById(userId, id);
    if (!mission) throw new MissionNotFound(id);

    mission.park(this.clock.now());
    await this.missions.update(userId, mission, null);
    return mission;
  }
}

/**
 * Unparking is where the WIP limit bites a second time, and it has to: otherwise
 * parking three missions and unparking them all is a supported way around FR-M4.
 *
 * Note what this does *not* do yet — §5.3 says unparking restores review items at
 * their real due dates, which means an immediately large queue, and that the app
 * should say so first and offer to spread the backlog over two weeks. There are no
 * review items until M5, so there is nothing to restore and nothing to warn about.
 * When M5 lands, that behaviour belongs here.
 */
@Injectable()
export class UnparkMission {
  constructor(
    @Inject(MISSION_REPOSITORY) private readonly missions: MissionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, id: string): Promise<Mission> {
    const mission = await this.missions.findById(userId, id);
    if (!mission) throw new MissionNotFound(id);

    // Ordered so that a mission which is not parked reports *that*, rather than a
    // WIP-limit error that would send you off to park something irrelevant.
    if (mission.status === "parked") {
      const active = await this.missions.countActive(userId);
      if (active >= MISSION_WIP_LIMIT) throw new WipLimitReached(MISSION_WIP_LIMIT);
    }

    mission.unpark(this.clock.now());
    await this.missions.update(userId, mission, null);
    return mission;
  }
}
