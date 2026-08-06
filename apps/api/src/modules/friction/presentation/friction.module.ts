import { Module } from "@nestjs/common";
import { ATTRIBUTION_TARGETS } from "../application/attribution-targets.port.js";
import {
  AttributeFriction,
  GetFrictionChips,
  GetFrictionSummary,
  ListSessionFriction,
  LogFriction,
} from "../application/friction.use-cases.js";
import { FRICTION_EVENT_REPOSITORY } from "../domain/friction-event.repository.js";
import { PrismaAttributionTargetReader } from "../infrastructure/prisma-attribution-target.reader.js";
import { PrismaFrictionEventRepository } from "../infrastructure/prisma-friction-event.repository.js";
import { FrictionController } from "./friction.controller.js";

@Module({
  controllers: [FrictionController],
  providers: [
    LogFriction,
    AttributeFriction,
    ListSessionFriction,
    GetFrictionChips,
    GetFrictionSummary,
    { provide: FRICTION_EVENT_REPOSITORY, useClass: PrismaFrictionEventRepository },
    { provide: ATTRIBUTION_TARGETS, useClass: PrismaAttributionTargetReader },
  ],
  // The worker will log friction from automatic time capture (FR-F8, M9) through the same
  // command rather than a second write path.
  exports: [LogFriction],
})
export class FrictionModule {}
