import {
  bandFor,
  SUBJECT_FOR_KIND,
  type Band,
  type CloseGoalInput,
  type CreateGoalInput,
  type CreateGoalTargetInput,
  type GoalProgress,
  type ListGoalsQuery,
  type TargetDefinition,
  type UpdateGoalInput,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { ID_GENERATOR, type IdGenerator } from "../../../shared/ids/id-generator.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { GoalNotFound, GoalTargetNotFound, TargetSubjectMissing } from "../domain/errors.js";
import { GoalTarget } from "../domain/goal-target.js";
import { Goal, type GoalEvidence } from "../domain/goal.js";
import { GOAL_REPOSITORY, type GoalRepository } from "../domain/goal.repository.js";
import { GOAL_EVIDENCE, type EvidenceRequest, type GoalEvidenceReader } from "./evidence.port.js";
import { SUBJECT_EXISTENCE, type SubjectExistenceReader } from "./subject-existence.port.js";

/** A goal with its progress worked out — what every read returns. */
export interface GoalWithProgress {
  readonly goal: Goal;
  readonly progress: GoalProgress;
  readonly evidence: GoalEvidence;
}

/**
 * Shared by every use case that has to load one.
 *
 * A missing goal and another user's goal are the same 404 — telling the difference apart would confirm
 * the existence of a row the caller cannot see.
 */
async function load(repository: GoalRepository, userId: string, id: string): Promise<Goal> {
  const goal = await repository.findById(userId, id);
  if (!goal) throw new GoalNotFound(id);
  return goal;
}

@Injectable()
export class CreateGoal {
  constructor(
    @Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository,
    @Inject(SUBJECT_EXISTENCE) private readonly subjects: SubjectExistenceReader,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(userId: string, input: CreateGoalInput): Promise<Goal> {
    if (input.id) {
      const existing = await this.goals.findById(userId, input.id);
      if (existing) return existing;
    }

    const now = this.clock.now();
    const goal = Goal.create({
      id: input.id ?? this.ids.next(),
      userId,
      missionId: input.missionId ?? null,
      title: input.title,
      definitionOfDone: input.definitionOfDone ?? null,
      targetDate: input.targetDate ?? null,
      now,
    });

    for (const target of input.targets) {
      goal.addTarget(await this.buildTarget(userId, goal.id, target));
    }

    await this.goals.save(userId, goal);
    return goal;
  }

  private async buildTarget(
    userId: string,
    goalId: string,
    input: CreateGoalTargetInput,
  ): Promise<GoalTarget> {
    const { weight, id, ...definition } = input;
    await assertSubjectExists(this.subjects, userId, definition);

    return GoalTarget.create({
      id: id ?? this.ids.next(),
      userId,
      goalId,
      definition,
      weight,
      // Captured now, because §3.8 measures band distance from where the goal began — and there is no
      // way to recover it later once the skill has moved.
      bandAtStart: await this.bandAtStart(userId, definition),
    });
  }

  private async bandAtStart(userId: string, definition: TargetDefinition): Promise<Band | null> {
    if (definition.kind !== "skill_band") return null;
    const score = await this.subjects.skillScore(userId, definition.skillId);
    return bandFor(score);
  }
}

/**
 * Checked here rather than left to the foreign key.
 *
 * A constraint violation arrives from the driver as an opaque error and becomes a 500, while "that
 * skill no longer exists" is an ordinary thing to tell a client — and this is reachable simply by
 * having two tabs open.
 */
async function assertSubjectExists(
  subjects: SubjectExistenceReader,
  userId: string,
  definition: TargetDefinition,
): Promise<void> {
  const subject = SUBJECT_FOR_KIND[definition.kind];
  if (subject === null) return;

  const id =
    definition.kind === "resource_progress"
      ? definition.resourceId
      : definition.kind === "skill_band" || definition.kind === "review_accuracy"
        ? definition.skillId
        : definition.kind === "focus_hours" || definition.kind === "lessons_completed"
          ? definition.missionId
          : null;
  if (id === null) return;

  if (!(await subjects.exists(userId, subject, id))) throw new TargetSubjectMissing(subject, id);
}

@Injectable()
export class EditGoal {
  // No clock: `goals` has no `updated_at`, so none of these writes has a timestamp to record.
  constructor(@Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository) {}

  async execute(userId: string, id: string, input: UpdateGoalInput): Promise<Goal> {
    const goal = await load(this.goals, userId, id);
    goal.edit({
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.definitionOfDone === undefined ? {} : { definitionOfDone: input.definitionOfDone }),
      ...(input.targetDate === undefined ? {} : { targetDate: input.targetDate }),
      ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
    });
    await this.goals.save(userId, goal);
    return goal;
  }
}

@Injectable()
export class CloseGoal {
  // No clock: `goals` has no `updated_at`, so none of these writes has a timestamp to record.
  constructor(@Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository) {}

  async execute(userId: string, id: string, input: CloseGoalInput): Promise<Goal> {
    const goal = await load(this.goals, userId, id);
    goal.close(input.status, input.outcomeNote ?? null);
    await this.goals.save(userId, goal);
    return goal;
  }
}

@Injectable()
export class ReopenGoal {
  // No clock: `goals` has no `updated_at`, so none of these writes has a timestamp to record.
  constructor(@Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository) {}

  async execute(userId: string, id: string): Promise<Goal> {
    const goal = await load(this.goals, userId, id);
    goal.reopen();
    await this.goals.save(userId, goal);
    return goal;
  }
}

@Injectable()
export class AddGoalTarget {
  constructor(
    @Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository,
    @Inject(SUBJECT_EXISTENCE) private readonly subjects: SubjectExistenceReader,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(userId: string, goalId: string, input: CreateGoalTargetInput): Promise<Goal> {
    const goal = await load(this.goals, userId, goalId);
    const { weight, id, ...definition } = input;

    await assertSubjectExists(this.subjects, userId, definition);

    // Idempotent on a supplied id, so a retried add is not a second target on the same goal.
    if (id && goal.findTarget(id)) return goal;

    const bandAtStart =
      definition.kind === "skill_band"
        ? bandFor(await this.subjects.skillScore(userId, definition.skillId))
        : null;

    goal.addTarget(
      GoalTarget.create({
        id: id ?? this.ids.next(),
        userId,
        goalId,
        definition,
        weight,
        bandAtStart,
      }),
    );

    await this.goals.save(userId, goal);
    return goal;
  }
}

@Injectable()
export class RemoveGoalTarget {
  constructor(@Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository) {}

  async execute(userId: string, goalId: string, targetId: string): Promise<Goal> {
    const goal = await load(this.goals, userId, goalId);
    if (!goal.findTarget(targetId)) throw new GoalTargetNotFound(targetId);

    goal.removeTarget(targetId);
    await this.goals.deleteTarget(userId, goalId, targetId);
    return goal;
  }
}

/**
 * The escape hatch (§3.8) — the only write in this module that sets a target's own state.
 *
 * The entity refuses it for every other kind, so this cannot become a way to hand-enter a computed
 * number.
 */
@Injectable()
export class SetManualTarget {
  constructor(
    @Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    goalId: string,
    targetId: string,
    satisfied: boolean,
  ): Promise<Goal> {
    const goal = await load(this.goals, userId, goalId);
    const target = goal.findTarget(targetId);
    if (!target) throw new GoalTargetNotFound(targetId);

    target.setManually(satisfied, this.clock.now());
    await this.goals.save(userId, goal);
    return goal;
  }
}

/** Generous but bounded: goals are few by design, and the WIP limit keeps missions fewer. */
const DEFAULT_LIMIT = 100;

@Injectable()
export class ListGoals {
  constructor(
    @Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository,
    @Inject(GOAL_EVIDENCE) private readonly evidence: GoalEvidenceReader,
  ) {}

  async execute(userId: string, query: ListGoalsQuery): Promise<GoalWithProgress[]> {
    const goals = await this.goals.list(userId, { ...query, limit: DEFAULT_LIMIT });

    // One evidence read for every target on the screen rather than one per goal. Progress is derived
    // on every read (§3.8), so this is the hot path of the goals screen.
    const evidence = await this.evidence.read(userId, goals.flatMap(requestsFor));

    return goals.map((goal) => ({ goal, progress: goal.progress(evidence), evidence }));
  }
}

@Injectable()
export class GetGoal {
  constructor(
    @Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository,
    @Inject(GOAL_EVIDENCE) private readonly evidence: GoalEvidenceReader,
  ) {}

  async execute(userId: string, id: string): Promise<GoalWithProgress> {
    const goal = await load(this.goals, userId, id);
    const evidence = await this.evidence.read(userId, requestsFor(goal));
    return { goal, progress: goal.progress(evidence), evidence };
  }
}

/**
 * Recomputes a goal's targets and persists any `met_at` that moved (§3.8).
 *
 * Called after a write that touches a source, and by the nightly job. Separate from the reads because
 * a read must never write — a GET that stamps rows makes every page load a mutation, and makes an
 * innocent refresh change the data you are looking at.
 */
@Injectable()
export class RecomputeGoal {
  constructor(
    @Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository,
    @Inject(GOAL_EVIDENCE) private readonly evidence: GoalEvidenceReader,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, goalId: string): Promise<GoalWithProgress> {
    const goal = await load(this.goals, userId, goalId);
    const evidence = await this.evidence.read(userId, requestsFor(goal));

    if (goal.observe(evidence, this.clock.now())) {
      for (const target of goal.targets) {
        await this.goals.saveTargetMetAt(userId, target);
      }
    }

    return { goal, progress: goal.progress(evidence), evidence };
  }
}

/**
 * A goal's targets paired with the window their progress is measured over.
 *
 * The goal's own `createdAt` is that window (§3.8: "sum of focus minutes since goal start"). Built
 * here rather than stored per target, because it is a fact about the goal and a second copy would be a
 * second thing to keep in step.
 */
function requestsFor(goal: Goal): EvidenceRequest[] {
  const countFrom = goal.createdAt;
  return goal.targets.map((target) => ({ target, countFrom }));
}
