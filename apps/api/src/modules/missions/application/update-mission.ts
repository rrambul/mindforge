import type { MissionFields, UpdateMissionInput } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { MissionNotFound } from "../domain/errors.js";
import type { Mission } from "../domain/mission.js";
import { MISSION_REPOSITORY, type MissionRepository } from "../domain/mission.repository.js";

/**
 * FR-M1 and FR-M2 — editing a mission, and recording that it drifted.
 *
 * A mission can be edited in any status. Parking freezes *nagging*, not the
 * mission itself (FR-M4b), and refining what you meant while something is parked
 * is exactly when it tends to happen.
 */
@Injectable()
export class UpdateMission {
  constructor(
    @Inject(MISSION_REPOSITORY) private readonly missions: MissionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, id: string, input: UpdateMissionInput): Promise<Mission> {
    const mission = await this.missions.findById(userId, id);
    if (!mission) throw new MissionNotFound(id);

    const { reason, ...fields } = input;
    const revision = mission.applyEdit(
      fields as Partial<MissionFields>,
      reason ?? null,
      this.clock.now(),
    );

    // Saved even when nothing changed, so `updatedAt` is not silently rewritten by
    // a no-op — applyEdit leaves it alone and the write is then genuinely idempotent.
    await this.missions.update(userId, mission, revision);
    return mission;
  }
}
