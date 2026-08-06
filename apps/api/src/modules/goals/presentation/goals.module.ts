import { Module } from "@nestjs/common";
import { GOAL_EVIDENCE } from "../application/evidence.port.js";
import {
  AddGoalTarget,
  CloseGoal,
  CreateGoal,
  EditGoal,
  GetGoal,
  ListGoals,
  RecomputeGoal,
  RemoveGoalTarget,
  ReopenGoal,
  SetManualTarget,
} from "../application/goal.use-cases.js";
import { SUBJECT_EXISTENCE } from "../application/subject-existence.port.js";
import { GOAL_REPOSITORY } from "../domain/goal.repository.js";
import { PrismaGoalEvidenceReader } from "../infrastructure/prisma-goal-evidence.reader.js";
import { PrismaGoalRepository } from "../infrastructure/prisma-goal.repository.js";
import { PrismaSubjectExistenceReader } from "../infrastructure/prisma-subject-existence.reader.js";
import { GoalsController } from "./goals.controller.js";

/**
 * `RecomputeGoal` is exported because the nightly `scores:recompute` job drives it (§3.8) — a
 * `skill_band` target moves through decay rather than through any write, so without that job a goal
 * would never notice it had been met.
 */
@Module({
  controllers: [GoalsController],
  providers: [
    CreateGoal,
    EditGoal,
    CloseGoal,
    ReopenGoal,
    AddGoalTarget,
    RemoveGoalTarget,
    SetManualTarget,
    ListGoals,
    GetGoal,
    RecomputeGoal,
    { provide: GOAL_REPOSITORY, useClass: PrismaGoalRepository },
    { provide: GOAL_EVIDENCE, useClass: PrismaGoalEvidenceReader },
    { provide: SUBJECT_EXISTENCE, useClass: PrismaSubjectExistenceReader },
  ],
  exports: [RecomputeGoal, ListGoals],
})
export class GoalsModule {}
