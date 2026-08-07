import { Module } from "@nestjs/common";
import { NightlyRun } from "../application/nightly-run.js";
import { NIGHTLY_GATEWAY } from "../application/nightly.port.js";
import { PrismaNightlyGateway } from "../infrastructure/prisma-nightly.gateway.js";
import { NightlyScheduler } from "./scheduler.js";

/** §10's `insights:rollup`, `notify:stall-detection`, and the weekly-review reminder. */
@Module({
  providers: [
    NightlyScheduler,
    NightlyRun,
    { provide: NIGHTLY_GATEWAY, useClass: PrismaNightlyGateway },
  ],
})
export class NightlyModule {}
