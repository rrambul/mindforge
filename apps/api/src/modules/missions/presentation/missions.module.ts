import { Module } from "@nestjs/common";
import { CreateMission } from "../application/create-mission.js";
import { ParkMission, UnparkMission } from "../application/park-mission.js";
import { GetMission, ListMissions } from "../application/read-missions.js";
import { UpdateMission } from "../application/update-mission.js";
import { MISSION_REPOSITORY } from "../domain/mission.repository.js";
import { PrismaMissionRepository } from "../infrastructure/prisma-mission.repository.js";
import { MissionsController } from "./missions.controller.js";

/**
 * Binds tokens to implementations — the only place that knows a `MissionRepository`
 * is backed by Prisma.
 *
 * The use cases are exported because the worker will call them directly (§2.1
 * decision 2): a BullMQ processor should be a thin adapter over the same command the
 * HTTP layer runs, not a second implementation of the same write.
 */
@Module({
  controllers: [MissionsController],
  providers: [
    CreateMission,
    UpdateMission,
    ParkMission,
    UnparkMission,
    ListMissions,
    GetMission,
    { provide: MISSION_REPOSITORY, useClass: PrismaMissionRepository },
  ],
  exports: [CreateMission, UpdateMission, ParkMission, UnparkMission],
})
export class MissionsModule {}
