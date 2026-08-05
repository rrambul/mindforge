import { MISSION_WIP_LIMIT, type CreateMissionInput } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { ID_GENERATOR, type IdGenerator } from "../../../shared/ids/id-generator.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { WipLimitReached } from "../domain/errors.js";
import { Mission } from "../domain/mission.js";
import { MISSION_REPOSITORY, type MissionRepository } from "../domain/mission.repository.js";

/**
 * FR-M1 and FR-M4.
 *
 * The WIP check lives here rather than in the entity because it is a rule about
 * the *set* of a user's missions. An entity that had to know how many siblings it
 * has would need a repository, and a domain object that queries the database is
 * no longer a domain object.
 *
 * Checked-then-written without a lock, deliberately. `UserScopedDb.run` opens a
 * transaction per repository call, so the count and the insert are two separate
 * transactions and two concurrent creates can both see two active missions and both
 * commit. A user racing themselves to a fourth simultaneous mission is not a threat
 * model for a single-user product, and the honest fix costs more than the scatter it
 * prevents.
 *
 * If it ever does matter, the fix is not a comment about transactions: it is either a
 * partial unique index (`where status = 'active'` over a generated slot number) or a
 * single repository method that counts and inserts inside one `run`. Both are real
 * work — do not assume the atomicity is already there.
 */
@Injectable()
export class CreateMission {
  constructor(
    @Inject(MISSION_REPOSITORY) private readonly missions: MissionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(userId: string, input: CreateMissionInput): Promise<Mission> {
    const active = await this.missions.countActive(userId);
    if (active >= MISSION_WIP_LIMIT) throw new WipLimitReached(MISSION_WIP_LIMIT);

    const mission = Mission.create({
      id: this.ids.next(),
      userId,
      fields: input,
      now: this.clock.now(),
    });

    await this.missions.create(userId, mission);
    return mission;
  }
}
