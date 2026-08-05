import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { AccountModule } from "./modules/account/presentation/account.module.js";
import { MissionsModule } from "./modules/missions/presentation/missions.module.js";
import { SharedModule } from "./shared/shared.module.js";

@Module({
  imports: [SharedModule, AccountModule, MissionsModule],
  controllers: [HealthController],
})
export class AppModule {}
