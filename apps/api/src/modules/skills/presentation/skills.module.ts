import { Module } from "@nestjs/common";
import {
  AddPrerequisite,
  CreateSkill,
  DeleteSkill,
  EditSkill,
  GetSkill,
  ListSkills,
  RateSkill,
  RemovePrerequisite,
} from "../application/skill.use-cases.js";
import { SyncCurriculumSkills } from "../application/workspace-skills.js";
import { SKILL_REPOSITORY } from "../domain/skill.repository.js";
import { WORKSPACE_SKILL_WRITER } from "../domain/workspace-skill.writer.js";
import { PrismaSkillRepository } from "../infrastructure/prisma-skill.repository.js";
import { PrismaWorkspaceSkillWriter } from "../infrastructure/prisma-workspace-skill.writer.js";
import { SkillsController } from "./skills.controller.js";

/**
 * `ListSkills` and `GetSkill` are exported because goal targets read a skill's score (§3.8) and the
 * eventual ZPD recommendation reads the graph — both through this module rather than by querying the
 * table a second way.
 *
 * `SyncCurriculumSkills` is exported for the same reason `SyncWorkspaceResources` is: the reindexer
 * turns a generated `CURRICULUM.md` into skills, and whoever owns the table owns the write (§2.1
 * decision 2). It goes through its own writer rather than `CreateSkill`, whose job is to reject the
 * duplicate name a human almost certainly typed by mistake — here a repeated slug is the normal case
 * and adopting the existing row is the point.
 */
@Module({
  controllers: [SkillsController],
  providers: [
    CreateSkill,
    EditSkill,
    RateSkill,
    AddPrerequisite,
    RemovePrerequisite,
    DeleteSkill,
    ListSkills,
    GetSkill,
    SyncCurriculumSkills,
    { provide: SKILL_REPOSITORY, useClass: PrismaSkillRepository },
    { provide: WORKSPACE_SKILL_WRITER, useClass: PrismaWorkspaceSkillWriter },
  ],
  exports: [ListSkills, GetSkill, SyncCurriculumSkills],
})
export class SkillsModule {}
