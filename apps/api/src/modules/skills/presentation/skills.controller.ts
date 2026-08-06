import {
  AddPrerequisiteSchema,
  CreateSkillSchema,
  ListSkillsQuerySchema,
  RateSkillSchema,
  UpdateSkillSchema,
  UuidSchema,
  type AddPrerequisiteInput,
  type Band,
  type CalibrationVerdict,
  type CreateSkillInput,
  type Feather,
  type ListSkillsQuery,
  type RateSkillInput,
  type UpdateSkillInput,
} from "@mindforge/core";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import {
  AddPrerequisite,
  CreateSkill,
  DeleteSkill,
  EditSkill,
  GetSkill,
  ListSkills,
  RateSkill,
  RemovePrerequisite,
  type SkillWithDerived,
} from "../application/skill.use-cases.js";

export interface SkillView {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  /** The self-rating. Null means you have not said (FR-S5). */
  readonly perceivedLevel: number | null;
  /**
   * The **decayed** score, which is what the gauge draws (FR-S4).
   *
   * Null means unproven — never 0, which would claim evidence that you cannot do it.
   */
  readonly score: number | null;
  readonly scoreStdDev: number | null;
  readonly band: Band | null;
  /** Uncertainty as feathered edges rather than a ± footnote (§9.1). */
  readonly feather: Feather;
  readonly halfLifeDays: number;
  readonly lastEvidenceAt: string | null;
  /** `perceived - demonstrated`. Null when either half is missing, with `missing` saying which. */
  readonly calibrationGap: number | null;
  readonly calibrationVerdict: CalibrationVerdict | null;
  readonly calibrationMissing: "score" | "self_rating" | "both" | null;
  readonly bandGap: number | null;
  readonly prerequisiteIds: readonly string[];
  readonly createdAt: string;
}

/**
 * `/v1/skills` (FR-S1..S6).
 *
 * No endpoint accepts a score. `PATCH /:id/rating` takes a self-rating and writes only that column —
 * which is the whole architecture of FR-S5: the two numbers stay independent, so the gap between them
 * means something.
 */
@Controller("skills")
export class SkillsController {
  constructor(
    private readonly create: CreateSkill,
    private readonly edit: EditSkill,
    private readonly rate: RateSkill,
    private readonly addPrereq: AddPrerequisite,
    private readonly removePrereq: RemovePrerequisite,
    private readonly remove: DeleteSkill,
    private readonly list: ListSkills,
    private readonly get: GetSkill,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private view(derived: SkillWithDerived): SkillView {
    const now = this.clock.now();
    const snapshot = derived.skill.toSnapshot();

    return {
      id: snapshot.id,
      name: snapshot.name,
      slug: snapshot.slug,
      description: snapshot.description,
      perceivedLevel: snapshot.perceivedLevel,
      // Decayed, not stored. Two callers reading different numbers for one skill is the failure
      // non-negotiable 3 forbids, so there is one source and it is computed here.
      score: derived.skill.currentScore(now),
      scoreStdDev: snapshot.scoreStdDev,
      band: derived.skill.currentBand(now),
      feather: derived.skill.feather(now),
      halfLifeDays: snapshot.halfLifeDays,
      lastEvidenceAt: snapshot.lastEvidenceAt?.toISOString() ?? null,
      calibrationGap: derived.calibration.gap,
      calibrationVerdict: derived.calibration.verdict,
      calibrationMissing: derived.calibration.missing,
      bandGap: derived.calibration.bandGap,
      prerequisiteIds: derived.prerequisiteIds,
      createdAt: snapshot.createdAt.toISOString(),
    };
  }

  @Get()
  async listSkills(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(ListSkillsQuerySchema)) query: ListSkillsQuery,
  ): Promise<{ skills: SkillView[] }> {
    const skills = await this.list.execute(user.userId, query);
    // Already ordered dependency-first by the use case, so nothing is re-sorted here.
    return { skills: skills.map((derived) => this.view(derived)) };
  }

  @Get(":id")
  async getSkill(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<SkillView> {
    return this.view(await this.get.execute(user.userId, id));
  }

  @Post()
  async createSkill(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(CreateSkillSchema)) body: CreateSkillInput,
  ): Promise<SkillView> {
    const skill = await this.create.execute(user.userId, body);
    return this.view(await this.get.execute(user.userId, skill.id));
  }

  @Patch(":id")
  async updateSkill(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(UpdateSkillSchema)) body: UpdateSkillInput,
  ): Promise<SkillView> {
    await this.edit.execute(user.userId, id, body);
    return this.view(await this.get.execute(user.userId, id));
  }

  /** FR-S5. Writes the self-rating and nothing else — see the controller note. */
  @Patch(":id/rating")
  async rateSkill(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(RateSkillSchema)) body: RateSkillInput,
  ): Promise<SkillView> {
    await this.rate.execute(user.userId, id, body);
    return this.view(await this.get.execute(user.userId, id));
  }

  /** FR-S1. Refused with a 409 when it would close a loop. */
  @Post(":id/prerequisites")
  async addPrerequisite(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(AddPrerequisiteSchema)) body: AddPrerequisiteInput,
  ): Promise<SkillView> {
    await this.addPrereq.execute(user.userId, id, body.prereqId);
    return this.view(await this.get.execute(user.userId, id));
  }

  @Delete(":id/prerequisites/:prereqId")
  async removePrerequisite(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Param("prereqId", zodPipe(UuidSchema)) prereqId: string,
  ): Promise<SkillView> {
    await this.removePrereq.execute(user.userId, id, prereqId);
    return this.view(await this.get.execute(user.userId, id));
  }

  @Delete(":id")
  @HttpCode(204)
  async deleteSkill(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<void> {
    await this.remove.execute(user.userId, id);
  }
}
