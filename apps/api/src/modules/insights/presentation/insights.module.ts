import { Module } from "@nestjs/common";
import { ACTIVITY_GRID_READER } from "../application/activity-grid.port.js";
import { BACKLOG_READER } from "../application/backlog.port.js";
import { FRICTION_ANALYTICS_READER } from "../application/friction-analytics.port.js";
import {
  GetActivityGrid,
  GetBacklogHealth,
  GetFrictionAnalytics,
} from "../application/insights.use-cases.js";
import { PrismaActivityGridReader } from "../infrastructure/prisma-activity-grid.reader.js";
import { PrismaBacklogReader } from "../infrastructure/prisma-backlog.reader.js";
import { PrismaFrictionAnalyticsReader } from "../infrastructure/prisma-friction-analytics.reader.js";
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
    GetBacklogHealth,
    GetFrictionAnalytics,
    { provide: ACTIVITY_GRID_READER, useClass: PrismaActivityGridReader },
    { provide: BACKLOG_READER, useClass: PrismaBacklogReader },
    { provide: FRICTION_ANALYTICS_READER, useClass: PrismaFrictionAnalyticsReader },
  ],
})
export class InsightsModule {}
