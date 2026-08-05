import { Module } from "@nestjs/common";

/**
 * The worker reuses the API's use cases rather than reimplementing writes —
 * a BullMQ processor is a thin adapter: deserialize job, call use case, record
 * result. Feature modules are imported here as they land. TECH-DESIGN.md §2.1.
 */
@Module({})
export class WorkerModule {}
