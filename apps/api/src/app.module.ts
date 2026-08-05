import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { SharedModule } from "./shared/shared.module.js";

@Module({
  imports: [SharedModule],
  controllers: [HealthController],
})
export class AppModule {}
