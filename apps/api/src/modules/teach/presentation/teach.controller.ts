import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";

import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
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
