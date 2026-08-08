import { Module } from "@nestjs/common";
import {
  DismissNotification,
  ListNotifications,
  MarkChangelogSeen,
  ReadNotificationPrefs,
  ReadProfile,
  SaveNotificationPrefs,
  UpdateSettings,
} from "../application/account.use-cases.js";
import { NOTIFICATION_REPOSITORY } from "../domain/notification.repository.js";
import { PROFILE_REPOSITORY } from "../domain/profile.repository.js";
import { PrismaNotificationRepository } from "../infrastructure/prisma-notification.repository.js";
import { PrismaProfileRepository } from "../infrastructure/prisma-profile.repository.js";
import { MeController } from "./me.controller.js";
import { NotificationsController } from "./notifications.controller.js";

/**
 * §6's `account` module. Export (FR-A4) and deletion land here too, as worker jobs.
 *
 * `ReadProfile` is exported because the nightly rollup needs the timezone and week start it reads,
 * and M3's worker is to call this use case rather than open its own path to the column — the same
 * rule that keeps the worker from reimplementing writes.
 */
@Module({
  controllers: [MeController, NotificationsController],
  providers: [
    ReadProfile,
    UpdateSettings,
    MarkChangelogSeen,
    ReadNotificationPrefs,
    SaveNotificationPrefs,
    ListNotifications,
    DismissNotification,
    { provide: PROFILE_REPOSITORY, useClass: PrismaProfileRepository },
    { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
  ],
  exports: [ReadProfile],
})
export class AccountModule {}
