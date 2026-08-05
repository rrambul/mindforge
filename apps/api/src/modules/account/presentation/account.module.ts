import { Module } from "@nestjs/common";
import { MeController } from "./me.controller.js";

/**
 * §6's `account` module. Export (FR-A4) and deletion land here too, as worker jobs.
 */
@Module({ controllers: [MeController] })
export class AccountModule {}
