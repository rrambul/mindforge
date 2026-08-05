import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { AccountModule } from "./modules/account/presentation/account.module.js";
import { FocusModule } from "./modules/focus/presentation/focus.module.js";
import { FrictionModule } from "./modules/friction/presentation/friction.module.js";
import { MissionsModule } from "./modules/missions/presentation/missions.module.js";
import { NotesModule } from "./modules/notes/presentation/notes.module.js";
import { SharedModule } from "./shared/shared.module.js";

@Module({
  imports: [SharedModule, AccountModule, MissionsModule, FocusModule, FrictionModule, NotesModule],
  controllers: [HealthController],
})
export class AppModule {}
