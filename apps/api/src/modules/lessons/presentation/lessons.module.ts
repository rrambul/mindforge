import { Module } from "@nestjs/common";

import { ENV, type Env } from "../../../shared/config/env.js";
import { LESSON_VIEW_CONFIG } from "../application/lesson-view.port.js";
import {
  ClearLessonCompletion,
  CompleteLesson,
  GetLesson,
} from "../application/lessons.use-cases.js";
import { LIBRARY_READER } from "../application/library.port.js";
import { ReadLearningRecords, ReadReferenceLibrary } from "../application/read-library.js";
import { ViewGrants } from "../application/view-grants.js";
import { LESSON_REPOSITORY } from "../domain/lesson.repository.js";
import { PrismaLessonRepository } from "../infrastructure/prisma-lesson.repository.js";
import { PrismaLibraryReader } from "../infrastructure/prisma-library.reader.js";
import { LessonsController } from "./lessons.controller.js";
import { LibraryController } from "./library.controller.js";

/**
 * The reader, the outcome, and the two browsable collections (FR-T5, FR-P1, FR-T6).
 *
 * `LESSON_REPOSITORY` is exported because the focus module needs it: binding a
 * session to a lesson (FR-F3) has to check that the lesson is yours before writing
 * the id, and reaching for this module's repository through its module is how that
 * stays a declared dependency rather than a second query in a different file.
 *
 * Nothing here writes a lesson's *content*. Files are canonical (non-negotiable 5),
 * so the title, the module and the plan are the reindexer's to write from the
 * workspace — this module owns exactly two columns, `completed_at` and `outcome`,
 * which are the only facts about a lesson that come from the learner.
 */
@Module({
  controllers: [LessonsController, LibraryController],
  providers: [
    GetLesson,
    CompleteLesson,
    ClearLessonCompletion,
    ReadReferenceLibrary,
    ReadLearningRecords,
    ViewGrants,
    { provide: LESSON_REPOSITORY, useClass: PrismaLessonRepository },
    { provide: LIBRARY_READER, useClass: PrismaLibraryReader },
    {
      // Two values rather than the whole `Env`, for the reason
      // `MEMORY_STORAGE_CONFIG` gives: a provider should depend on what it uses.
      provide: LESSON_VIEW_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        lessonsOrigin: env.LESSONS_ORIGIN,
        tokenSecret: env.LESSONS_TOKEN_SECRET,
      }),
    },
  ],
  exports: [LESSON_REPOSITORY],
})
export class LessonsModule {}
