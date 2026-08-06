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
import { SKILL_REPOSITORY } from "../domain/skill.repository.js";
import { PrismaSkillRepository } from "../infrastructure/prisma-skill.repository.js";
import { SkillsController } from "./skills.controller.js";

/**
 * `ListSkills` and `GetSkill` are exported because goal targets read a skill's score (§3.8) and the
 * eventual ZPD recommendation reads the graph — both through this module rather than by querying the
 * table a second way.
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
    { provide: SKILL_REPOSITORY, useClass: PrismaSkillRepository },
  ],
  exports: [ListSkills, GetSkill],
})
export class SkillsModule {}
