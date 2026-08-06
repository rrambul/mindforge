import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { AccountModule } from "./modules/account/presentation/account.module.js";
import { FocusModule } from "./modules/focus/presentation/focus.module.js";
import { FrictionModule } from "./modules/friction/presentation/friction.module.js";
import { GoalsModule } from "./modules/goals/presentation/goals.module.js";
import { MissionsModule } from "./modules/missions/presentation/missions.module.js";
import { NotesModule } from "./modules/notes/presentation/notes.module.js";
import { ResourcesModule } from "./modules/resources/presentation/resources.module.js";
import { SkillsModule } from "./modules/skills/presentation/skills.module.js";
import { SharedModule } from "./shared/shared.module.js";

@Module({
  imports: [
    SharedModule,
    AccountModule,
    MissionsModule,
    FocusModule,
    FrictionModule,
    NotesModule,
    ResourcesModule,
    GoalsModule,
    SkillsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
