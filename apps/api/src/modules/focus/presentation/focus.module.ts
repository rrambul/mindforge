import { Module } from "@nestjs/common";
import {
  DebriefFocusSession,
  RecordFocusSession,
  StartFocusSession,
  StopFocusSession,
} from "../application/focus-session.commands.js";
import { GetRunningFocusSession, ListFocusSessions } from "../application/read-focus-sessions.js";
import { FOCUS_SESSION_REPOSITORY } from "../domain/focus-session.repository.js";
import { PrismaFocusSessionRepository } from "../infrastructure/prisma-focus-session.repository.js";
import { FocusController } from "./focus.controller.js";

/**
 * The repository is exported as well as the commands: the friction module needs to check that
 * a session belongs to the caller before attaching an event to it, and reaching for another
 * module's repository through its module is how that stays a declared dependency rather than
 * a second Prisma query in a different file.
 */
@Module({
  controllers: [FocusController],
  providers: [
    StartFocusSession,
    StopFocusSession,
    DebriefFocusSession,
    RecordFocusSession,
    GetRunningFocusSession,
    ListFocusSessions,
    { provide: FOCUS_SESSION_REPOSITORY, useClass: PrismaFocusSessionRepository },
  ],
  exports: [
    StartFocusSession,
    StopFocusSession,
    DebriefFocusSession,
    RecordFocusSession,
    FOCUS_SESSION_REPOSITORY,
  ],
})
export class FocusModule {}
