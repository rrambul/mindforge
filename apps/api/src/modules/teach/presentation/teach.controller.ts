import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";

import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { LearnerMemories } from "../application/learner-memories.js";
import type { LearnerMemoryView } from "../application/memory.port.js";
import { TeachRuns } from "../application/teach.use-cases.js";
import type { AgentRun } from "../domain/agent-run.js";

export interface AgentRunView {
  readonly id: string;
  readonly missionId: string | null;
  readonly kind: string;
  readonly status: string;
  /** Present only once the run has finished, and null on a clean one. */
  readonly error: string | null;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export function toAgentRunView(run: AgentRun): AgentRunView {
  return {
    id: run.id,
    missionId: run.missionId,
    kind: run.kind,
    status: run.status,
    error: run.error,
    result: run.result as Readonly<Record<string, unknown>> | null,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    // `heartbeatAt` is deliberately absent. It is a liveness lease between the
    // worker and the reaper, and putting it on the wire invites a client to
    // reimplement staleness — a second, differently-wrong opinion about whether a
    // run is alive.
  };
}

/**
 * `/v1/missions/:id/teach` and `/v1/agent-runs/:id` (§6).
 *
 * **202, not 201.** A lesson takes minutes, so the endpoint returns a run id and
 * the SPA watches it (§6: long operations never block a request). The resource
 * created is the run, not the lesson — and saying 201 would invite a client to
 * expect a lesson in the body.
 */
@Controller()
export class TeachController {
  constructor(private readonly runs: TeachRuns) {}

  /**
   * Queue a teach run for a mission.
   *
   * A 409 here is not a failure to explain away: one run per mission at a time is
   * a product rule, and the SPA branches on the `run-already-active` slug to show
   * the run in progress rather than an error. That is the honest answer to "teach
   * me something" while something is being taught.
   */
  @Post("missions/:missionId/teach")
  @HttpCode(202)
  async teach(
    @CurrentUser() user: RequestContext,
    @Param("missionId", ParseUUIDPipe) missionId: string,
  ): Promise<AgentRunView> {
    return toAgentRunView(await this.runs.request(user.userId, missionId));
  }

  @Get("agent-runs/:id")
  async run(
    @CurrentUser() user: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AgentRunView> {
    return toAgentRunView(await this.runs.get(user.userId, id));
  }

  /** A mission's run history, newest first — what the mission screen shows. */
  @Get("missions/:missionId/agent-runs")
  async history(
    @CurrentUser() user: RequestContext,
    @Param("missionId", ParseUUIDPipe) missionId: string,
    @Query("limit") limit?: string,
  ): Promise<readonly AgentRunView[]> {
    const capped = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const runs = await this.runs.listForMission(user.userId, missionId, capped);
    return runs.map(toAgentRunView);
  }
}

export interface MemoryView {
  readonly id: string;
  readonly slug: string;
  readonly kind: string;
  readonly summary: string;
  readonly writtenBy: string;
  readonly confirmedAt: string | null;
  readonly supersededBySlug: string | null;
  readonly updatedAt: string;
}

function toMemoryView(memory: LearnerMemoryView): MemoryView {
  return {
    id: memory.id,
    slug: memory.slug,
    kind: memory.kind,
    summary: memory.summary,
    writtenBy: memory.writtenBy,
    confirmedAt: memory.confirmedAt?.toISOString() ?? null,
    supersededBySlug: memory.supersededBySlug,
    updatedAt: memory.updatedAt.toISOString(),
  };
}

/**
 * `/v1/me/memory` (§7.6) — what the agent has concluded about you.
 *
 * Under `me` rather than under a mission, because that is what it is: memory
 * spans every mission, and filing it under one would suggest it belonged there.
 *
 * The three verbs are the whole of "the agent writes it; you own it". There is no
 * create — §7.6 is explicit that an onboarding questionnaire is the wrong answer,
 * because what people say up front about how they learn is usually wrong.
 */
@Controller("me/memory")
export class LearnerMemoryController {
  constructor(private readonly memories: LearnerMemories) {}

  @Get()
  async list(@CurrentUser() user: RequestContext): Promise<readonly MemoryView[]> {
    return (await this.memories.list(user.userId)).map(toMemoryView);
  }

  /** The learner agreeing with an inference, which is worth more than silence. */
  @Post(":id/confirm")
  async confirm(
    @CurrentUser() user: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<MemoryView> {
    return toMemoryView(await this.memories.confirm(user.userId, id));
  }

  /**
   * The learner disagreeing, which deletes outright.
   *
   * Not a supersession: that is what the *agent* does when it changes its mind,
   * and the record of having believed something is worth keeping. A memory the
   * learner rejects is different — it is wrong, it is replayed into every future
   * run on every mission, and leaving a tombstone would keep feeding it back.
   */
  @Delete(":id")
  @HttpCode(204)
  async forget(
    @CurrentUser() user: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.memories.forget(user.userId, id);
  }
}
