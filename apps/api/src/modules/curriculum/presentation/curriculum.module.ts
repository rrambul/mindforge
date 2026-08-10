import { Module } from "@nestjs/common";

import { CURRICULUM_READER } from "../application/curriculum.port.js";
import { GetCurriculum } from "../application/get-curriculum.js";
import { PrismaCurriculumReader } from "../infrastructure/prisma-curriculum.reader.js";
import { CurriculumController } from "./curriculum.controller.js";

/**
 * Nothing is exported: this module reads and never writes. The curriculum is
 * *written* by the teach module's reindexer, from `CURRICULUM.md`, because files
 * are canonical (non-negotiable 5) — so there is no command here another context
 * could reuse, and an endpoint that edited a module would be a second writer for
 * a table the workspace owns.
 */
@Module({
  controllers: [CurriculumController],
  providers: [GetCurriculum, { provide: CURRICULUM_READER, useClass: PrismaCurriculumReader }],
})
export class CurriculumModule {}
