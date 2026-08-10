import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { AccountModule } from "./modules/account/presentation/account.module.js";
import { FocusModule } from "./modules/focus/presentation/focus.module.js";
import { InsightsModule } from "./modules/insights/presentation/insights.module.js";
import { MissionsModule } from "./modules/missions/presentation/missions.module.js";
import { TeachModule } from "./modules/teach/presentation/teach.module.js";
import { SharedModule } from "./shared/shared.module.js";

@Module({
  imports: [SharedModule, AccountModule, MissionsModule, FocusModule, InsightsModule, TeachModule],
  controllers: [HealthController],
})
export class AppModule {}
