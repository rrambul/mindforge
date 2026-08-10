import { Module } from "@nestjs/common";
import {
  MarkChangelogSeen,
  ReadProfile,
  UpdateSettings,
} from "../application/account.use-cases.js";
import { PROFILE_REPOSITORY } from "../domain/profile.repository.js";
import { PrismaProfileRepository } from "../infrastructure/prisma-profile.repository.js";
import { MeController } from "./me.controller.js";

/**
 * §6's `account` module. Export (FR-A4) and deletion land here too, as worker jobs.
 *
 * `ReadProfile` is exported because the nightly rollup needs the timezone and week start it reads,
 * and M3's worker is to call this use case rather than open its own path to the column — the same
 * rule that keeps the worker from reimplementing writes.
 */
@Module({
  controllers: [MeController],
  providers: [
    ReadProfile,
    UpdateSettings,
    MarkChangelogSeen,
    { provide: PROFILE_REPOSITORY, useClass: PrismaProfileRepository },
  ],
  exports: [ReadProfile],
})
export class AccountModule {}
