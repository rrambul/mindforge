import {
  skillSlug,
  topologicalOrder,
  wouldCreateCycle,
  type Calibration,
  type CreateSkillInput,
  type ListSkillsQuery,
  type PrereqEdge,
  type RateSkillInput,
  type UpdateSkillInput,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { ID_GENERATOR, type IdGenerator } from "../../../shared/ids/id-generator.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import {
  PrerequisiteCycle,
  SelfPrerequisite,
  SkillNameTaken,
  SkillNotFound,
} from "../domain/errors.js";
import { Skill } from "../domain/skill.js";
import { SKILL_REPOSITORY, type SkillRepository } from "../domain/skill.repository.js";

/** A skill with everything derived at read time, so nothing here is a stored duplicate. */
export interface SkillWithDerived {
  readonly skill: Skill;
  readonly prerequisiteIds: readonly string[];
  readonly calibration: Calibration;
}

async function load(repository: SkillRepository, userId: string, id: string): Promise<Skill> {
  const skill = await repository.findById(userId, id);
  if (!skill) throw new SkillNotFound(id);
  return skill;
}

/**
 * Guards the DAG (FR-S1).
 *
 * Lives in the application layer rather than the entity because it is a rule about the **whole graph**,
 * not about one skill — an entity holding only its own edges cannot see that A→B→C→A closes a loop, and
 * the transitive case is the only one worth guarding. Same reasoning as the mission WIP limit.
 */
async function assertAcyclic(
  repository: SkillRepository,
  userId: string,
  skillId: string,
  prereqId: string,
): Promise<void> {
  if (skillId === prereqId) throw new SelfPrerequisite(skillId);

  const edges = await repository.edges(userId);
  if (wouldCreateCycle(edges, skillId, prereqId)) throw new PrerequisiteCycle(skillId, prereqId);
}

@Injectable()
export class CreateSkill {
  constructor(
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(userId: string, input: CreateSkillInput): Promise<Skill> {
    if (input.id) {
      const existing = await this.skills.findById(userId, input.id);
      if (existing) return existing;
    }

    const skillId = input.id ?? this.ids.next();
    const slug = skillSlug(input.name);
    // Checked rather than left to the unique constraint: "Rust" twice is almost always a mistake, and a
    // constraint violation would arrive from the driver as a 500 instead of something the form can show.
    if (await this.skills.findBySlug(userId, slug)) throw new SkillNameTaken(input.name);

    // Every prerequisite is checked to exist **before** anything is written.
    //
    // It used to be validated after the save, and not for existence at all — so an id pointing at a
    // nonexistent or another user's skill reached `addEdge` and died on the foreign key as an opaque
    // 500, which is the exact failure the check in `AddPrerequisite` exists to avoid. Worse, a
    // rejection partway through the loop left the skill and the earlier edges committed while the
    // caller saw an error, so a retry hit a duplicate-name conflict on a skill it did not know it had.
    //
    // RLS makes another user's skill invisible, so "does not exist" and "not yours" are the same
    // answer — and it is the right one either way.
    const prerequisiteIds = [...new Set(input.prerequisiteIds)];
    for (const prereqId of prerequisiteIds) {
      if (prereqId === skillId) throw new SelfPrerequisite(skillId);
      if (!(await this.skills.findById(userId, prereqId))) throw new SkillNotFound(prereqId);
    }

    const skill = Skill.create({
      id: skillId,
      userId,
      name: input.name,
      slug,
      description: input.description ?? null,
      perceivedLevel: input.perceivedLevel ?? null,
      now: this.clock.now(),
    });

    await this.skills.save(userId, skill);

    // No cycle is possible here — the id is new, so nothing in the stored graph can reach it — but the
    // check runs anyway rather than resting on that reasoning holding after some future edit.
    for (const prereqId of prerequisiteIds) {
      await assertAcyclic(this.skills, userId, skill.id, prereqId);
      await this.skills.addEdge(userId, { skillId: skill.id, prereqId });
    }

    return skill;
  }
}

@Injectable()
export class EditSkill {
  constructor(@Inject(SKILL_REPOSITORY) private readonly skills: SkillRepository) {}

  async execute(userId: string, id: string, input: UpdateSkillInput): Promise<Skill> {
    const skill = await load(this.skills, userId, id);

    if (input.name !== undefined && input.name !== skill.name) {
      const slug = skillSlug(input.name);
      const clash = await this.skills.findBySlug(userId, slug);
      if (clash && clash.id !== skill.id) throw new SkillNameTaken(input.name);
      // The slug follows the name. It is stored so a rename does not break a link, but a renamed skill
      // whose slug still says the old thing is a link that lies about where it goes.
      skill.edit({ name: input.name, slug });
    }

    skill.edit({
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.perceivedLevel === undefined ? {} : { perceivedLevel: input.perceivedLevel }),
      ...(input.halfLifeDays === undefined ? {} : { halfLifeDays: input.halfLifeDays }),
    });

    await this.skills.save(userId, skill);
    return skill;
  }
}

/**
 * The self-rating (FR-S5) — the only number a person can set on a skill.
 *
 * Its own use case because it is the one thing updated often, and because keeping it separate makes the
 * "a rating is not evidence" rule visible in the shape of the code: this writes `perceivedLevel` and
 * touches nothing else.
 */
@Injectable()
export class RateSkill {
  constructor(@Inject(SKILL_REPOSITORY) private readonly skills: SkillRepository) {}

  async execute(userId: string, id: string, input: RateSkillInput): Promise<Skill> {
    const skill = await load(this.skills, userId, id);
    skill.rate(input.perceivedLevel);
    await this.skills.save(userId, skill);
    return skill;
  }
}

@Injectable()
export class AddPrerequisite {
  constructor(@Inject(SKILL_REPOSITORY) private readonly skills: SkillRepository) {}

  async execute(userId: string, skillId: string, prereqId: string): Promise<void> {
    // Both must exist and be this user's. RLS makes another user's invisible, so a missing skill and
    // someone else's are the same answer — which is the right one either way.
    await load(this.skills, userId, skillId);
    await load(this.skills, userId, prereqId);

    await assertAcyclic(this.skills, userId, skillId, prereqId);
    await this.skills.addEdge(userId, { skillId, prereqId });
  }
}

@Injectable()
export class RemovePrerequisite {
  constructor(@Inject(SKILL_REPOSITORY) private readonly skills: SkillRepository) {}

  async execute(userId: string, skillId: string, prereqId: string): Promise<void> {
    await load(this.skills, userId, skillId);
    // No cycle check: removing an edge can never create one. Idempotent, so a repeated delete is fine.
    await this.skills.removeEdge(userId, { skillId, prereqId });
  }
}

@Injectable()
export class DeleteSkill {
  constructor(@Inject(SKILL_REPOSITORY) private readonly skills: SkillRepository) {}

  async execute(userId: string, id: string): Promise<void> {
    await load(this.skills, userId, id);
    // Edges go with it through the schema's cascade — a prerequisite pointing at a deleted skill is an
    // edge to nothing, and leaving it would break the ordering of everything downstream.
    await this.skills.delete(userId, id);
  }
}

/** Generous: a skill library is browsed, and there is no paged view until M2. */
const DEFAULT_LIMIT = 500;

@Injectable()
export class ListSkills {
  constructor(
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, query: ListSkillsQuery): Promise<SkillWithDerived[]> {
    const [skills, edges] = await Promise.all([
      this.skills.list(userId, { limit: DEFAULT_LIMIT }),
      this.skills.edges(userId),
    ]);

    const now = this.clock.now();
    const prerequisitesBySkill = groupPrerequisites(edges);

    let derived = skills.map((skill) => ({
      skill,
      prerequisiteIds: prerequisitesBySkill.get(skill.id) ?? [],
      calibration: skill.calibration(now),
    }));

    // Filtered on the *decayed* band, not a stored one. Asking for "everything at Working" and getting
    // a skill that was Working a year ago would be the exact staleness FR-S4 exists to remove.
    if (query.band) derived = derived.filter((d) => d.skill.currentBand(now) === query.band);
    if (query.overconfidentOnly) {
      derived = derived.filter((d) => d.calibration.verdict === "overconfident");
    }

    return orderByPrerequisites(derived, edges);
  }
}

@Injectable()
export class GetSkill {
  constructor(
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, id: string): Promise<SkillWithDerived> {
    const [skill, edges] = await Promise.all([
      load(this.skills, userId, id),
      this.skills.edges(userId),
    ]);

    return {
      skill,
      prerequisiteIds: groupPrerequisites(edges).get(id) ?? [],
      calibration: skill.calibration(this.clock.now()),
    };
  }
}

function groupPrerequisites(edges: readonly PrereqEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = map.get(edge.skillId);
    if (existing) existing.push(edge.prereqId);
    else map.set(edge.skillId, [edge.prereqId]);
  }
  return map;
}

/**
 * Dependency-first, so what you need first appears first.
 *
 * Falls back to the given order when the stored graph turns out to be cyclic. That should be
 * unreachable — every write goes through `assertAcyclic` — but a hand-edited row can produce it, and
 * refusing to render the skill library because one edge is wrong would be a worse failure than an
 * imperfect order.
 */
function orderByPrerequisites(
  derived: readonly SkillWithDerived[],
  edges: readonly PrereqEdge[],
): SkillWithDerived[] {
  const order = topologicalOrder(
    derived.map((d) => d.skill.id),
    edges,
  );
  if (order === null) return [...derived];

  const rank = new Map(order.map((id, index) => [id, index] as const));
  return [...derived].sort((a, b) => (rank.get(a.skill.id) ?? 0) - (rank.get(b.skill.id) ?? 0));
}
