import { Module } from "@nestjs/common";

import { CURRICULUM_READER } from "../application/curriculum.port.js";
import { DEADLINE_WRITER } from "../application/deadline.port.js";
import { GetCurriculum } from "../application/get-curriculum.js";
import { SetDeadline } from "../application/set-deadline.js";
import { PrismaCurriculumReader } from "../infrastructure/prisma-curriculum.reader.js";
import { PrismaDeadlineWriter } from "../infrastructure/prisma-deadline.writer.js";
import { CurriculumController } from "./curriculum.controller.js";

/**
 * Nothing is exported, and nothing here writes the curriculum. It is *written* by
 * the teach module's reindexer, from `CURRICULUM.md`, because files are canonical
 * (non-negotiable 5) — an endpoint that edited a module would be a second writer
 * for a table the workspace owns.
 *
 * The one write is a module's deadline (FR-U2), which is learner data with no file,
 * like a lesson's outcome: `module_deadlines`, append-only, never `tracks`.
 */
@Module({
  controllers: [CurriculumController],
  providers: [
    GetCurriculum,
    SetDeadline,
    { provide: CURRICULUM_READER, useClass: PrismaCurriculumReader },
    { provide: DEADLINE_WRITER, useClass: PrismaDeadlineWriter },
  ],
})
export class CurriculumModule {}
