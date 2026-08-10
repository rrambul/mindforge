import { Module } from "@nestjs/common";
import { ACTIVITY_GRID_READER } from "../application/activity-grid.port.js";
import { GetActivityGrid } from "../application/insights.use-cases.js";
import { PrismaActivityGridReader } from "../infrastructure/prisma-activity-grid.reader.js";
import { InsightsController } from "./insights.controller.js";

/**
 * Nothing is exported. This module reads and never writes, so there is no command another module
 * could reuse — and an insight another context wanted would be a query it should own itself.
 *
 * `ETagInterceptor` is not listed: Nest's scanner registers a class enhancer named in
 * `@UseInterceptors` as an injectable of the module that declares the controller, and repeating it
 * here would suggest something else can inject it.
 */
@Module({
  controllers: [InsightsController],
  providers: [
    GetActivityGrid,
    { provide: ACTIVITY_GRID_READER, useClass: PrismaActivityGridReader },
  ],
})
export class InsightsModule {}
