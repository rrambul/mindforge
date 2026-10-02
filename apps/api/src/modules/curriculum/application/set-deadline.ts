import { calendarDaysBetween, type CurriculumView, type SetDeadlineInput } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";

import { DeadlineInPast, ModuleDropped, ModuleFinished, ModuleNotFound } from "../domain/errors.js";
import { DEADLINE_WRITER, type DeadlineWriter } from "./deadline.port.js";
import { GetCurriculum } from "./get-curriculum.js";

/**
 * Committing to a date for a module, or moving one (FR-U2).
 *
 * Decided against the curriculum as the learner sees it, read through the same
 * `GetCurriculum` the screen calls — so "finished", "dropped" and "today" here are
 * exactly the ones on screen, and a refusal can never be about a state the learner
 * was not shown.
 *
 * **Re-committing the date already in force writes nothing.** It is not a move, and
 * recording it as one would tell the learner they moved a deadline they kept.
 *
 * Returns the curriculum, re-read, because a deadline changes more than its own
 * module's line: the proposal goes, and the status beside it appears.
 */
@Injectable()
export class SetDeadline {
  constructor(
    private readonly curriculum: GetCurriculum,
    @Inject(DEADLINE_WRITER) private readonly deadlines: DeadlineWriter,
  ) {}

  async execute(
    userId: string,
    missionId: string,
    moduleId: string,
    timezone: string,
    input: SetDeadlineInput,
  ): Promise<CurriculumView> {
    const view = await this.curriculum.execute(userId, missionId, timezone);
    const module = view.modules.find((candidate) => candidate.id === moduleId);

    if (module === undefined) throw new ModuleNotFound(moduleId);
    if (module.status === "dropped") throw new ModuleDropped(moduleId);
    if (module.finishedAt !== null) throw new ModuleFinished(moduleId);
    if (calendarDaysBetween(view.today, input.dueOn) < 0) {
      throw new DeadlineInPast(input.dueOn, view.today);
    }

    if (module.deadline?.dueOn === input.dueOn) return view;

    await this.deadlines.append(userId, moduleId, input.dueOn);
    return this.curriculum.execute(userId, missionId, timezone);
  }
}
