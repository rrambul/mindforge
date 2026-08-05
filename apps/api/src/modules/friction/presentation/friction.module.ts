import { Module } from "@nestjs/common";
import {
  GetFrictionChips,
  GetFrictionSummary,
  LogFriction,
} from "../application/friction.use-cases.js";
import { FRICTION_EVENT_REPOSITORY } from "../domain/friction-event.repository.js";
import { PrismaFrictionEventRepository } from "../infrastructure/prisma-friction-event.repository.js";
import { FrictionController } from "./friction.controller.js";

@Module({
  controllers: [FrictionController],
  providers: [
    LogFriction,
    GetFrictionChips,
    GetFrictionSummary,
    { provide: FRICTION_EVENT_REPOSITORY, useClass: PrismaFrictionEventRepository },
  ],
  // The worker will log friction from automatic time capture (FR-F8, M9) through the same
  // command rather than a second write path.
  exports: [LogFriction],
})
export class FrictionModule {}
