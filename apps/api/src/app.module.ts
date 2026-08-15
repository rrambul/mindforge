import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { AccountModule } from "./modules/account/presentation/account.module.js";
import { CurriculumModule } from "./modules/curriculum/presentation/curriculum.module.js";
import { FocusModule } from "./modules/focus/presentation/focus.module.js";
import { InsightsModule } from "./modules/insights/presentation/insights.module.js";
import { LessonsModule } from "./modules/lessons/presentation/lessons.module.js";
import { MissionsModule } from "./modules/missions/presentation/missions.module.js";
import { TeachModule } from "./modules/teach/presentation/teach.module.js";
import { LoggingModule } from "./shared/logging/logger.module.js";
import { SharedModule } from "./shared/shared.module.js";

@Module({
  imports: [
    SharedModule,
    // After SharedModule, because its factory injects ENV from it. Before every
    // feature module, so the request-context middleware is registered ahead of the
    // routes it has to wrap — a logger imported last logs the requests it missed.
    LoggingModule.forRoot(),
    AccountModule,
    MissionsModule,
    FocusModule,
    InsightsModule,
    CurriculumModule,
    LessonsModule,
    TeachModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
