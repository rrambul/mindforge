import { Module } from "@nestjs/common";
import { LessonsModule } from "../../lessons/presentation/lessons.module.js";
import {
  DebriefFocusSession,
  RecordFocusSession,
  StartFocusSession,
  StopFocusSession,
} from "../application/focus-session.commands.js";
import { GetRunningFocusSession, ListFocusSessions } from "../application/read-focus-sessions.js";
import { ResolveSessionSubject } from "../application/session-subject.js";
import { FOCUS_SESSION_REPOSITORY } from "../domain/focus-session.repository.js";
import { PrismaFocusSessionRepository } from "../infrastructure/prisma-focus-session.repository.js";
import { FocusController } from "./focus.controller.js";

/**
 * The repository is exported as well as the commands: another module needing to check that a
 * session belongs to the caller before attaching something to it should reach for it through
 * this module, which keeps the dependency declared rather than a second Prisma query in a
 * different file.
 *
 * `LessonsModule` is imported for the other direction of exactly that rule. Binding a session
 * to a lesson (FR-F3) has to know the lesson is yours and which mission it is in, and both
 * facts already have one reader.
 */
@Module({
  imports: [LessonsModule],
  controllers: [FocusController],
  providers: [
    ResolveSessionSubject,
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
